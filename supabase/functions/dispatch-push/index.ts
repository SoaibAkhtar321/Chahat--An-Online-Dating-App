import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildPushPayload, isRetryableProviderStatus, type PushDisplayContext } from "./policy.ts";
import { safeErrorSummary } from "../_shared/safeLog.ts";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function constantTimeEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

async function updateDelivery(
  admin: ReturnType<typeof createClient>,
  deliveryId: string,
  status: "submitted" | "retry" | "failed",
  providerTicket: string | null,
  errorCode: string | null,
) {
  const { error } = await admin.rpc("complete_push_delivery", {
    _delivery_id: deliveryId,
    _status: status,
    _provider_ticket: providerTicket,
    _error_code: errorCode,
  });
  if (error) throw new Error(`Delivery state update failed: ${error.message}`);
}

async function deactivateDevice(admin: ReturnType<typeof createClient>, deviceId: string) {
  const { error } = await admin.rpc("deactivate_push_device", { _device_id: deviceId });
  if (error) throw new Error(`Invalid device cleanup failed: ${error.message}`);
}

async function completeReceipt(
  admin: ReturnType<typeof createClient>,
  deliveryId: string,
  delivered: boolean,
  errorCode: string | null,
) {
  const { error } = await admin.rpc("complete_push_receipt", {
    _delivery_id: deliveryId,
    _delivered: delivered,
    _error_code: errorCode,
  });
  if (error) throw new Error(`Receipt state update failed: ${error.message}`);
}

async function processReceipts(admin: ReturnType<typeof createClient>) {
  const receiptCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  // Expo only keeps receipts for 24 hours. Anything older can never be confirmed, so close it out
  // instead of re-querying it forever (and starving fresher rows of the 1000-row window).
  const expiryCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale, error: staleError } = await admin
    .from("notification_deliveries")
    .select("id")
    .eq("status", "submitted")
    .is("receipt_checked_at", null)
    .lt("submitted_at", expiryCutoff)
    .order("submitted_at", { ascending: true })
    .limit(200);
  if (staleError) throw new Error(`Receipt expiry query failed: ${staleError.message}`);
  for (const row of (stale ?? []) as Array<{ id: string }>) {
    await completeReceipt(admin, row.id, false, "ReceiptExpired");
  }

  const { data, error } = await admin
    .from("notification_deliveries")
    .select("id, device_id, provider_ticket")
    .eq("status", "submitted")
    .is("receipt_checked_at", null)
    .lte("submitted_at", receiptCutoff)
    .gte("submitted_at", expiryCutoff)
    .order("submitted_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Receipt query failed: ${error.message}`);

  const pending = (data ?? []).filter(
    (row: { id: string; device_id: string; provider_ticket: string | null }) =>
      typeof row.provider_ticket === "string" && row.provider_ticket.length > 0,
  );
  for (let offset = 0; offset < pending.length; offset += 300) {
    const batch = pending.slice(offset, offset + 300);
    let response: Response;
    try {
      response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ids: batch.map((row) => row.provider_ticket) }),
      });
    } catch (error) {
      console.error("Expo receipt request failed; receipts will be retried.");
      continue;
    }
    if (!response.ok) {
      console.error("Expo receipt service returned HTTP status", response.status);
      continue;
    }

    const body = await response.json();
    const receipts = body?.data ?? {};
    for (const row of batch) {
      const receipt = receipts[row.provider_ticket];
      if (!receipt) continue;
      if (receipt.status === "ok") {
        await completeReceipt(admin, row.id, true, null);
        continue;
      }
      const code =
        typeof receipt.details?.error === "string" ? receipt.details.error : "ProviderError";
      if (code === "DeviceNotRegistered") await deactivateDevice(admin, row.device_id);
      await completeReceipt(admin, row.id, false, code.slice(0, 80));
    }
  }
}

async function loadDisplayContexts(
  admin: ReturnType<typeof createClient>,
  notificationIds: string[],
): Promise<Map<string, PushDisplayContext>> {
  const contexts = new Map<string, PushDisplayContext>();
  const unique = [...new Set(notificationIds)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const { data, error } = await admin.rpc("get_push_display_context", {
      _notification_ids: unique.slice(offset, offset + 100),
    });
    // Lock-screen details are optional: on any failure fall back to the generic copy rather than
    // failing or delaying the notification.
    if (error) {
      console.error("Push display context unavailable; using generic copy.");
      continue;
    }
    for (const row of (data ?? []) as Array<{
      notification_id: string;
      sender_name: string | null;
      preview: string | null;
    }>) {
      contexts.set(row.notification_id, { senderName: row.sender_name, preview: row.preview });
    }
  }
  return contexts;
}

async function processDeliveries(admin: ReturnType<typeof createClient>) {
  const { error: materializeError } = await admin.rpc("materialize_push_deliveries", {
    _limit: 100,
  });
  if (materializeError)
    throw new Error(`Notification materialization failed: ${materializeError.message}`);

  const { data: deliveries, error } = await admin.rpc("claim_push_deliveries", { _limit: 100 });
  if (error) throw new Error(`Notification claim failed: ${error.message}`);
  const jobs = (deliveries ?? []) as Array<{
    delivery_id: string;
    notification_id: string;
    device_id: string;
    push_token: string;
    category: "like" | "match" | "message" | "call";
    route_data: Record<string, unknown>;
  }>;

  const displayContexts = await loadDisplayContexts(
    admin,
    jobs.filter((job) => job.category === "message" || job.category === "match").map((job) => job.notification_id),
  );

  for (let offset = 0; offset < jobs.length; offset += 100) {
    const batch = jobs.slice(offset, offset + 100);
    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          batch.map((job) =>
            buildPushPayload(
              job.push_token,
              job.notification_id,
              job.category,
              job.route_data ?? {},
              displayContexts.get(job.notification_id),
            ),
          ),
        ),
      });
    } catch {
      for (const job of batch) {
        await updateDelivery(admin, job.delivery_id, "retry", null, "NetworkError");
      }
      continue;
    }

    if (!response.ok) {
      const retry = isRetryableProviderStatus(response.status);
      for (const job of batch) {
        await updateDelivery(
          admin,
          job.delivery_id,
          retry ? "retry" : "failed",
          null,
          `HTTP${response.status}`,
        );
      }
      continue;
    }

    let body: { data?: Array<Record<string, unknown>> };
    try {
      body = await response.json();
    } catch {
      for (const job of batch) {
        await updateDelivery(admin, job.delivery_id, "retry", null, "InvalidResponse");
      }
      continue;
    }

    const tickets = Array.isArray(body.data) ? body.data : [];
    for (let index = 0; index < batch.length; index++) {
      const job = batch[index]!;
      const ticket = tickets[index];
      if (ticket?.status === "ok" && typeof ticket.id === "string") {
        await updateDelivery(admin, job.delivery_id, "submitted", ticket.id, null);
        continue;
      }
      const code =
        typeof ticket?.details === "object" &&
        ticket.details !== null &&
        "error" in ticket.details &&
        typeof ticket.details.error === "string"
          ? ticket.details.error
          : typeof ticket?.message === "string"
            ? ticket.message
            : "ProviderError";
      if (code === "DeviceNotRegistered") await deactivateDevice(admin, job.device_id);
      const retry = code === "MessageRateExceeded" || code === "ProviderError";
      await updateDelivery(
        admin,
        job.delivery_id,
        retry ? "retry" : "failed",
        null,
        code.slice(0, 80),
      );
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const dispatchSecret = Deno.env.get("PUSH_DISPATCH_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!dispatchSecret || !url || !serviceRoleKey) {
    return json(503, { error: "Push dispatcher is not configured", code: "push_not_configured" });
  }
  const suppliedSecret = request.headers.get("x-dispatch-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, dispatchSecret)) {
    return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    await processDeliveries(admin);
    await processReceipts(admin);
    return json(200, { accepted: true });
  } catch (error) {
    console.error(
      "Push dispatcher run failed:",
      safeErrorSummary(error),
    );
    return json(500, { error: "Push dispatch run failed; queued work remains retryable" });
  }
});

// Supported cities with approximate city-centre coordinates. MUST match the seed in
// supabase/migrations/20260101004300_location_selection_and_city_anchor.sql (a Jest test enforces this).
// City centres are used only as a coarse anchor; they are not member locations.
export interface CityInfo {
  name: string;
  latitude: number;
  longitude: number;
}

export const SUPPORTED_CITIES: readonly CityInfo[] = [
  { name: "Mumbai", latitude: 19.08, longitude: 72.88 },
  { name: "Delhi", latitude: 28.61, longitude: 77.21 },
  { name: "Bengaluru", latitude: 12.97, longitude: 77.59 },
  { name: "Hyderabad", latitude: 17.39, longitude: 78.49 },
  { name: "Chennai", latitude: 13.08, longitude: 80.27 },
  { name: "Kolkata", latitude: 22.57, longitude: 88.36 },
  { name: "Pune", latitude: 18.52, longitude: 73.86 },
  { name: "Jaipur", latitude: 26.91, longitude: 75.79 },
  { name: "Ahmedabad", latitude: 23.02, longitude: 72.57 },
  { name: "Lucknow", latitude: 26.85, longitude: 80.95 },
  { name: "Chandigarh", latitude: 30.73, longitude: 76.78 },
  { name: "Surat", latitude: 21.17, longitude: 72.83 },
  { name: "Kochi", latitude: 9.93, longitude: 76.27 },
  { name: "Indore", latitude: 22.72, longitude: 75.86 },
  { name: "Bhopal", latitude: 23.26, longitude: 77.41 },
  { name: "Nagpur", latitude: 21.15, longitude: 79.09 },
  { name: "Patna", latitude: 25.59, longitude: 85.14 },
  { name: "Vadodara", latitude: 22.31, longitude: 73.18 },
  { name: "Coimbatore", latitude: 11.02, longitude: 76.96 },
  { name: "Visakhapatnam", latitude: 17.69, longitude: 83.22 },
  { name: "Thiruvananthapuram", latitude: 8.52, longitude: 76.94 },
  { name: "Gurugram", latitude: 28.46, longitude: 77.03 },
  { name: "Noida", latitude: 28.54, longitude: 77.39 },
  { name: "Ghaziabad", latitude: 28.67, longitude: 77.42 },
  { name: "Faridabad", latitude: 28.41, longitude: 77.31 },
  { name: "Kanpur", latitude: 26.45, longitude: 80.35 },
  { name: "Agra", latitude: 27.18, longitude: 78.01 },
  { name: "Varanasi", latitude: 25.32, longitude: 83.01 },
  { name: "Amritsar", latitude: 31.63, longitude: 74.87 },
  { name: "Ludhiana", latitude: 30.9, longitude: 75.86 },
  { name: "Jodhpur", latitude: 26.24, longitude: 73.02 },
  { name: "Udaipur", latitude: 24.59, longitude: 73.71 },
  { name: "Nashik", latitude: 19.99, longitude: 73.79 },
  { name: "Mysuru", latitude: 12.3, longitude: 76.64 },
  { name: "Mangaluru", latitude: 12.91, longitude: 74.86 },
  { name: "Bhubaneswar", latitude: 20.3, longitude: 85.82 },
  { name: "Guwahati", latitude: 26.14, longitude: 91.74 },
  { name: "Ranchi", latitude: 23.34, longitude: 85.31 },
  { name: "Raipur", latitude: 21.25, longitude: 81.63 },
  { name: "Dehradun", latitude: 30.32, longitude: 78.03 },
  { name: "Panaji", latitude: 15.5, longitude: 73.83 },
  { name: "Madurai", latitude: 9.93, longitude: 78.12 },
  { name: "Thane", latitude: 19.22, longitude: 72.98 },
  { name: "Navi Mumbai", latitude: 19.03, longitude: 73.03 },
];

/** Shortcuts shown under the search box. They go through the same selection path as search results. */
export const POPULAR_CITIES: readonly string[] = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Ahmedabad",
];

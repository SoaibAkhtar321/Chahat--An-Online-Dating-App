module.exports = {
  preset: "jest-expo",
  resolver: "<rootDir>/jest.resolver.js",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/mobile/"],
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
};

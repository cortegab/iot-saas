// Tests talk to a fake API (each test mocks fetch); the client reads this at import.
process.env.EXPO_PUBLIC_API_URL = "https://api.example";

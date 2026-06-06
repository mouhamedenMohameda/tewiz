// Public env — exposed to the browser.
// Override in .env.local for production.
export const API_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:3000';

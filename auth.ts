// Re-export so route handlers can import from "@/auth" — Auth.js convention.
import { handlers, signIn, signOut, auth } from '@/lib/auth';
export const GET = handlers.GET;
export const POST = handlers.POST;
export { handlers, signIn, signOut, auth };

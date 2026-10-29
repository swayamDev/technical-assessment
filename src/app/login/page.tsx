import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Rent Collection" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <LoginForm />
    </main>
  );
}

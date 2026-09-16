import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getCurrentSession } from "@/lib/auth/server";

export default async function LoginPage() {
  if (await getCurrentSession()) redirect("/");

  return (
    <main className="login-shell">
      <section
        aria-labelledby="login-title"
        aria-modal="true"
        className="login-dialog"
        role="dialog"
      >
        <header className="login-dialog-header">
          <span className="login-brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <span className="eyebrow">Atlas</span>
            <h1 id="login-title">Вход в систему</h1>
          </div>
        </header>
        <div className="login-dialog-body">
          <p>Введите электронную почту и пароль для доступа к дашборду.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}

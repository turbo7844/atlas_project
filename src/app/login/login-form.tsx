"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Не удалось войти в систему.");
      }
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось войти в систему.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="login-form" onSubmit={(event) => void submit(event)}>
      <label className="login-field" htmlFor="email">
        <span>Электронная почта</span>
        <input
          autoComplete="username"
          autoFocus
          id="email"
          name="email"
          placeholder="name@example.ru"
          required
          type="email"
        />
      </label>
      <label className="login-field" htmlFor="password">
        <span>Пароль</span>
        <input
          aria-describedby={error ? "login-error" : undefined}
          autoComplete="current-password"
          id="password"
          name="password"
          placeholder="Введите пароль"
          required
          type="password"
        />
      </label>
      {error ? (
        <p className="login-error" id="login-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="login-submit" disabled={pending} type="submit">
        {pending ? "Проверяем…" : "Войти"}
      </button>
    </form>
  );
}

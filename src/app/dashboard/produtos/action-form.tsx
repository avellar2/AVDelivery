"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

export type MenuAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) {
    return null;
  }

  return <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>;
}

export function SimpleActionForm({
  action,
  children,
  className,
}: {
  action: MenuAction;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className={cn("min-w-0", className)}>
      {children}
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cn(
            "mt-1 text-xs font-medium",
            state.status === "error" ? "text-red-600" : "text-emerald-700",
          )}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ConfirmSubmitButton({
  message,
  children,
  variant = "danger",
  className,
}: {
  message: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </Button>
  );
}

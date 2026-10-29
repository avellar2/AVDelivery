import { Button, type ButtonVariant } from "@/components/ui/button";

export function SignOutButton({
  variant = "secondary",
  className,
  fullWidth = true,
}: {
  variant?: ButtonVariant;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <form action="/auth/signout" method="post" className={className}>
      <Button type="submit" variant={variant} className={fullWidth ? "w-full" : undefined}>
        Sair
      </Button>
    </form>
  );
}

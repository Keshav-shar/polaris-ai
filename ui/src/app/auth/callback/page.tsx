import { Suspense } from "react";
import { AuthCallback } from "../../../components/auth-callback";

export default function AuthCallbackPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Suspense fallback={null}>
        <AuthCallback />
      </Suspense>
    </div>
  );
}

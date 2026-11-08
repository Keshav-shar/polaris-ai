import { Suspense } from "react";
import { SignInForm } from "../../components/sign-in-form";

// The form reads ?next= with useSearchParams, so it sits in a Suspense boundary and the shell still prerenders
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div className="space-y-2 text-center">
        <h1 className="font-serif text-4xl font-bold text-ink">Sign in to Polaris</h1>
        <p className="text-sm text-muted">Your maps, lessons and progress are saved to your account.</p>
      </div>
      <div className="parchment-card rounded-2xl p-6 md:p-8">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}

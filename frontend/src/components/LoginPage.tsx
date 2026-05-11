import { auth } from '../api/client'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <h1 className="text-4xl font-serif font-bold text-ink tracking-tight mb-3">
          Manuscript Tracker
        </h1>
        <p className="text-muted mb-8">
          Track advisor feedback on your manuscript. Sign in to get started.
        </p>
        <button
          onClick={() => auth.login()}
          className="btn-primary"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

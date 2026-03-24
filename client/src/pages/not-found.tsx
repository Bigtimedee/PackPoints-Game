import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md mx-4 text-center space-y-6">
        <p className="text-7xl font-black text-gray-200 dark:text-gray-800 select-none">404</p>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Page Not Found</h1>
          <p className="text-gray-500 dark:text-gray-400">
            The page you were looking for does not exist or may have been moved.
          </p>
        </div>
        <Button onClick={() => navigate("/")} size="lg">
          Go Home
        </Button>
      </div>
    </div>
  );
}

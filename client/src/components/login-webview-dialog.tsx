import { ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function LoginWebviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
            <ExternalLink className="h-6 w-6 text-muted-foreground" />
          </div>
          <AlertDialogTitle className="text-center">Open in New Tab to Login</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Login doesn't work in the embedded preview. Click "New tab" in the header above to open this app in a full browser tab.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
          <p className="font-medium">How to Log In:</p>
          <ol className="text-muted-foreground space-y-1 list-decimal pl-4">
            <li>Look for the "New tab" button in the preview header</li>
            <li>Click it to open the app in a new browser tab</li>
            <li>Then click "Log in" from there</li>
          </ol>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Got it</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

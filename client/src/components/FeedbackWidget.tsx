import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const CATEGORIES = [
  { value: "bug", label: "🐛 Bug Report" },
  { value: "feature_request", label: "✨ Feature Request" },
  { value: "card_set_request", label: "🃏 Card Set Request" },
  { value: "general", label: "💬 General Feedback" },
];

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        category,
        message,
        pageUrl: window.location.href,
      });
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !message.trim()) return;
    submitMutation.mutate();
  };

  const handleClose = () => {
    setOpen(false);
    // Reset after close animation
    setTimeout(() => {
      setSubmitted(false);
      setCategory("");
      setMessage("");
    }, 300);
  };

  return (
    <>
      {/* Floating feedback button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label="Open feedback widget"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="max-w-sm" aria-describedby="feedback-description">
          <DialogHeader>
            <DialogTitle>Share Feedback</DialogTitle>
            <DialogDescription id="feedback-description">
              Help us improve PackPTS. All feedback is reviewed by the team.
            </DialogDescription>
          </DialogHeader>

          {submitted ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <p className="font-semibold">Thanks for your feedback!</p>
              <p className="text-sm text-muted-foreground">We read every submission and use it to prioritize improvements.</p>
              <Button variant="outline" size="sm" onClick={handleClose}>Close</Button>
              <div className="text-xs text-muted-foreground">
                <a href="/roadmap" className="underline hover:text-foreground">View our roadmap →</a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select required onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  required
                  placeholder="Tell us what's on your mind..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                />
              </div>
              {submitMutation.isError && (
                <p className="text-sm text-destructive">Something went wrong. Please try again.</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={!category || !message.trim() || submitMutation.isPending}
              >
                {submitMutation.isPending ? "Sending..." : "Send Feedback"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

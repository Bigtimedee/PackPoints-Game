import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Zap, Gift, ChevronRight, Check } from "lucide-react";

const ONBOARDING_KEY = "packpts_onboarded";

const steps = [
  {
    icon: Eye,
    title: "Guess the Player",
    description: "You'll see a sports trading card image with the player's name hidden. Study the card details, team colors, and stats.",
    badge: "Step 1 of 3",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Zap,
    title: "Earn PackPTS",
    description: "Answer correctly and earn PackPTS (points). Faster answers earn bonus points. Build a streak for multipliers!",
    badge: "Step 2 of 3",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  {
    icon: Gift,
    title: "Redeem for Real Cards",
    description: "Use your PackPTS to get discounts on real sports cards from our marketplace partners. Your knowledge pays off!",
    badge: "Step 3 of 3",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
];

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const hasOnboarded = localStorage.getItem(ONBOARDING_KEY);
    if (!hasOnboarded) {
      // Small delay so the page loads first
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setOpen(false);
  };

  const step = steps[currentStep];
  const Icon = step.icon;
  const isLastStep = currentStep === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleComplete(); }}>
      <DialogContent className="max-w-md" aria-describedby="onboarding-description">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="text-xs">{step.badge}</Badge>
          </div>
          <DialogTitle className="text-xl">Welcome to PackPTS!</DialogTitle>
        </DialogHeader>

        <div id="onboarding-description" className="space-y-6 py-4">
          <div className={`flex items-center justify-center w-20 h-20 rounded-2xl ${step.bg} mx-auto`}>
            <Icon className={`w-10 h-10 ${step.color}`} />
          </div>

          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">{step.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
          </div>

          {/* Step indicators */}
          <div className="flex justify-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? "w-8 bg-primary" : i < currentStep ? "w-4 bg-primary/40" : "w-4 bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button variant="ghost" size="sm" onClick={handleComplete} className="text-muted-foreground">
            Skip
          </Button>
          <Button onClick={handleNext} className="gap-2">
            {isLastStep ? (
              <>
                <Check className="w-4 h-4" />
                Let's Play!
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

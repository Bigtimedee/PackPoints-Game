import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { playQuestionCount } from "@/lib/setsPolish";
import { SignupModal } from "@/components/signup-modal";
import { ANON_GATE_CODE, type PublicAnonGate } from "@shared/anonGate";

export function usePlayMakerSet(setId: string | undefined, cardCount: unknown) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const totalQuestions = playQuestionCount(cardCount);
  const [blocked, setBlocked] = useState<PublicAnonGate | null>(null);

  const gateQuery = useQuery<PublicAnonGate | { anonymous: false; phase: string }>({
    queryKey: ["/api/anon/status"],
    enabled: !isAuthenticated,
    staleTime: 10_000,
  });
  const serverGate = gateQuery.data && "anonymous" in gateQuery.data && gateQuery.data.anonymous === true
    ? gateQuery.data
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!setId || totalQuestions == null) {
        throw new Error("This set has no playable cards yet.");
      }
      const res = await apiRequest("POST", "/api/game/start", {
        mode: "solo",
        totalQuestions,
        setId,
      });
      return res.json();
    },
    onSuccess: (data: { id?: string }) => {
      const sessionId = typeof data?.id === "string" ? data.id : "";
      setLocation(sessionId ? `/game/solo?session=${encodeURIComponent(sessionId)}` : "/game/solo");
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === ANON_GATE_CODE) {
        setBlocked({
          phase: "hard",
          canStart: false,
          prompt: "hard",
          reason: err.reason === "next_day" ? "next_day" : "game_cap",
          escrowPoints: err.escrowPoints ?? 0,
          gamesCompleted: err.gamesCompleted ?? 2,
          anonymous: true,
        });
        return;
      }
      toast({ title: "Couldn't start game", description: err.message, variant: "destructive" });
    },
  });

  function start() {
    if (!isAuthenticated && serverGate?.phase === "hard") {
      setBlocked(serverGate);
      return;
    }
    mutation.mutate();
  }

  const gatePrompt = blocked ? (
    <SignupModal
      open
      onOpenChange={(next) => {
        if (!next) setBlocked(null);
      }}
      variant="hard"
      gateReason={blocked.reason}
      pendingPoints={blocked.escrowPoints}
    />
  ) : null;

  return { ...mutation, mutate: start, canPlay: totalQuestions != null && !!setId, gatePrompt };
}

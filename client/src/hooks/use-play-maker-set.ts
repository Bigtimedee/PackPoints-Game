import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { playQuestionCount } from "@/lib/setsPolish";

export function usePlayMakerSet(setId: string | undefined, cardCount: unknown) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const totalQuestions = playQuestionCount(cardCount);

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
    onSuccess: () => {
      setLocation("/game/solo");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start game", description: err.message, variant: "destructive" });
    },
  });

  return { ...mutation, canPlay: totalQuestions != null && !!setId };
}

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Zap, Users, TrendingUp, Gift, Check, Star } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const TIERS = [
  {
    name: "Micro Creator",
    requirement: "1K–10K followers",
    icon: Zap,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    benefits: [
      "Exclusive creator affiliate link",
      "1.25× daily PackPTS earn cap",
      "Early access to new card sets",
      "Creator badge on profile",
    ],
  },
  {
    name: "Partner",
    requirement: "10K–100K followers",
    icon: Star,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    benefits: [
      "Everything in Micro Creator",
      "1.5× daily PackPTS earn cap",
      "Revenue share on referred purchases",
      "Monthly strategy call",
      "Custom promo codes",
    ],
  },
  {
    name: "Ambassador",
    requirement: "100K+ followers",
    icon: TrendingUp,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    benefits: [
      "Everything in Partner",
      "2× daily PackPTS earn cap",
      "Elevated revenue share",
      "Co-creation opportunities",
      "Priority feature requests",
      "PackPTS Pro subscription (free)",
    ],
  },
];

interface ApplicationForm {
  name: string;
  email: string;
  socialHandle: string;
  platform: string;
  followerCount: string;
  contentDescription: string;
  whyPackpts: string;
}

export default function Creators() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<ApplicationForm>({
    name: "",
    email: "",
    socialHandle: "",
    platform: "",
    followerCount: "",
    contentDescription: "",
    whyPackpts: "",
  });

  const applyMutation = useMutation({
    mutationFn: async (data: ApplicationForm) => {
      return apiRequest("POST", "/api/creators/apply", {
        ...data,
        followerCount: data.followerCount ? parseInt(data.followerCount) : null,
      });
    },
    onSuccess: () => setSubmitted(true),
  });

  const handleChange = (field: keyof ApplicationForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyMutation.mutate(form);
  };

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* Hero */}
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Creator Program</Badge>
          <h1 className="text-4xl font-bold mb-4">Partner with PackPTS</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            You love sports cards. Your audience does too. Turn that passion into rewards with our creator partnership program.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6 mb-12">
          {[
            { label: "Active Players", value: "10K+", icon: Users },
            { label: "Avg. Session", value: "12 min", icon: Zap },
            { label: "Cards in Library", value: "5,000+", icon: Gift },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-6 text-center">
                <Icon className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-3xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tiers */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-center mb-6">Program Tiers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => {
              const Icon = tier.icon;
              return (
                <Card key={tier.name} className="relative">
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-xl ${tier.bg} flex items-center justify-center mb-3`}>
                      <Icon className={`h-6 w-6 ${tier.color}`} />
                    </div>
                    <CardTitle>{tier.name}</CardTitle>
                    <CardDescription>{tier.requirement}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {tier.benefits.map((benefit) => (
                        <li key={benefit} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Application Form */}
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Apply to the Creator Program</CardTitle>
            <CardDescription>
              Fill out the form below and we'll review your application within 3 business days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <Check className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold">Application Submitted!</h3>
                <p className="text-muted-foreground">
                  We'll review your application and get back to you within 3 business days.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" required value={form.name} onChange={e => handleChange("name", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" required value={form.email} onChange={e => handleChange("email", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="platform">Primary Platform</Label>
                    <Select required onValueChange={v => handleChange("platform", v)}>
                      <SelectTrigger id="platform">
                        <SelectValue placeholder="Select platform" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="tiktok">TikTok</SelectItem>
                        <SelectItem value="youtube">YouTube</SelectItem>
                        <SelectItem value="twitter">Twitter/X</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="handle">Social Handle</Label>
                    <Input id="handle" required placeholder="@yourhandle" value={form.socialHandle} onChange={e => handleChange("socialHandle", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="followers">Approximate Follower Count</Label>
                  <Input id="followers" type="number" min="0" value={form.followerCount} onChange={e => handleChange("followerCount", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="content">Describe your content</Label>
                  <Textarea
                    id="content"
                    required
                    placeholder="What kind of content do you create? How often?"
                    value={form.contentDescription}
                    onChange={e => handleChange("contentDescription", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="why">Why do you want to partner with PackPTS?</Label>
                  <Textarea
                    id="why"
                    required
                    placeholder="Tell us what excites you about sports cards and PackPTS..."
                    value={form.whyPackpts}
                    onChange={e => handleChange("whyPackpts", e.target.value)}
                  />
                </div>
                {applyMutation.isError && (
                  <p className="text-sm text-destructive">
                    Something went wrong. Please try again.
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

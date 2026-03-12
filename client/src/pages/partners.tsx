import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Zap, TrendingUp, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const MARKETPLACE_PARTNERS = [
  {
    name: "eBay",
    logo: "eBay",
    description: "Redeem PackPTS for discounts on millions of sports cards from verified eBay sellers.",
    features: ["10% discount on qualifying listings", "Verified seller network", "Buyer protection"],
    active: true,
  },
  {
    name: "Goldin Auctions",
    logo: "Goldin",
    description: "Use your PackPTS at America's premier sports collectibles auction house.",
    features: ["VIP auction access", "Exclusive lots", "Authentication included"],
    active: true,
  },
];

interface InquiryForm {
  shopName: string;
  contactName: string;
  contactEmail: string;
  website: string;
  location: string;
  monthlyVolume: string;
  message: string;
}

export default function Partners() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<InquiryForm>({
    shopName: "",
    contactName: "",
    contactEmail: "",
    website: "",
    location: "",
    monthlyVolume: "",
    message: "",
  });

  const inquiryMutation = useMutation({
    mutationFn: async (data: InquiryForm) => apiRequest("POST", "/api/partner-inquiry", data),
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inquiryMutation.mutate(form);
  };

  const handleChange = (field: keyof InquiryForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* Hero */}
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Marketplace</Badge>
          <h1 className="text-4xl font-bold mb-4">Redeem PackPTS for Real Cards</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Your knowledge has value. Redeem the PackPTS you earn playing trivia for discounts on real sports cards from our marketplace partners.
          </p>
        </div>

        {/* How it Works */}
        <div className="grid grid-cols-3 gap-6 mb-12">
          {[
            { step: "1", title: "Earn PackPTS", desc: "Play trivia games and answer correctly to earn points.", icon: Zap },
            { step: "2", title: "Browse Cards", desc: "Find cards you want from our marketplace partners.", icon: TrendingUp },
            { step: "3", title: "Redeem", desc: "Apply your PackPTS for discounts at checkout.", icon: Users },
          ].map(({ step, title, desc, icon: Icon }) => (
            <Card key={step}>
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground mb-1">Step {step}</p>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Current Partners */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Our Partners</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {MARKETPLACE_PARTNERS.map((partner) => (
              <Card key={partner.name}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{partner.name}</CardTitle>
                    {partner.active && <Badge variant="secondary" className="text-green-600">Active</Badge>}
                  </div>
                  <CardDescription>{partner.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {partner.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Partner Application */}
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Become a PackPTS Partner</CardTitle>
            <CardDescription>
              Are you a card shop, dealer, or marketplace? Partner with PackPTS to reach thousands of engaged sports card collectors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <Check className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold">Inquiry Received!</h3>
                <p className="text-muted-foreground">We'll reach out to you within 2 business days.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Shop/Business Name</Label>
                    <Input required value={form.shopName} onChange={e => handleChange("shopName", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Contact Name</Label>
                    <Input required value={form.contactName} onChange={e => handleChange("contactName", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" required value={form.contactEmail} onChange={e => handleChange("contactEmail", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Website (optional)</Label>
                    <Input type="url" value={form.website} onChange={e => handleChange("website", e.target.value)} placeholder="https://" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input value={form.location} onChange={e => handleChange("location", e.target.value)} placeholder="City, State" />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Volume</Label>
                    <Select onValueChange={v => handleChange("monthlyVolume", v)}>
                      <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="under_10k">Under $10K/month</SelectItem>
                        <SelectItem value="10k_50k">$10K-$50K/month</SelectItem>
                        <SelectItem value="50k_200k">$50K-$200K/month</SelectItem>
                        <SelectItem value="over_200k">$200K+/month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Tell us about your business</Label>
                  <Textarea value={form.message} onChange={e => handleChange("message", e.target.value)} placeholder="What kinds of cards do you sell? How do you think we can work together?" />
                </div>
                {inquiryMutation.isError && <p className="text-sm text-destructive">Something went wrong. Please try again.</p>}
                <Button type="submit" className="w-full" disabled={inquiryMutation.isPending}>
                  {inquiryMutation.isPending ? "Submitting..." : "Submit Partnership Inquiry"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

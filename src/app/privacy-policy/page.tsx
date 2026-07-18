import { PageSection } from "@/components/PageSection";

export const metadata = {
  title: "Privacy Policy — Twilight.Feather",
  description: "How Twilight.Feather collects, uses, and protects your information.",
};

export default function PrivacyPolicyPage() {
  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-white/80">
          Your family&apos;s trust matters to us. Here is how we handle your
          information.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy" containerClassName="mx-auto max-w-3xl space-y-8">
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            What we collect
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            When you join our email list or make a purchase, we collect your
            email address and the details needed to complete your order. We do
            not collect more than we need, and we never collect information
            from children.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            How we use it
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            We use your email to send the updates and offers you signed up for,
            and order details to deliver your books. We do not sell or share
            your personal information with third parties for their marketing.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Payments
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Payments are processed securely by Stripe. We never see or store
            your full card details.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Questions
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            If you have any questions about this policy or want your
            information removed, reach out through our contact page and we will
            take care of it.
          </p>
        </div>
      </PageSection>
    </main>
  );
}

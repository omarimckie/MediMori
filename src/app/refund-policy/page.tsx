import { PageSection } from "@/components/PageSection";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy — Twilight Feather",
  description:
    "Twilight Feather’s limited refund policy for digital books and downloadable content.",
};

export default function RefundPolicyPage() {
  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Refund Policy
        </h1>
        <p className="mt-4 text-white/80">Last updated: August 16, 2026</p>
      </PageSection>

      <PageSection
        tone="white"
        cloudTop="navy"
        containerClassName="mx-auto max-w-3xl space-y-8"
      >
        <p className="leading-relaxed text-brand-charcoal/80">
          Thank you for supporting Twilight Feather.
        </p>
        <p className="leading-relaxed text-brand-charcoal/80">
          Because Twilight Feather provides digital books and downloadable
          digital content, we have a limited refund policy designed to protect
          both our customers and our digital products.
        </p>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            1. Refund period
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Refund requests should be submitted within 14 calendar days of the
            original purchase.
          </p>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Submitting a request does not automatically guarantee a refund. Each
            request is reviewed based on the circumstances of the transaction.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            2. When a refund may be approved
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            We may approve a refund when:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-brand-charcoal/80">
            <li>You were charged more than once for the same product.</li>
            <li>
              You paid for a product but cannot access it because of a technical
              problem on our side.
            </li>
            <li>
              You were charged for a different product than the one you
              purchased.
            </li>
            <li>
              The purchased digital product has a significant technical problem
              that prevents normal use.
            </li>
            <li>
              A transaction appears to be unauthorized and requires
              investigation.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            3. Digital-content access
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Because our products are delivered digitally, refunds are generally
            not available after the purchased content has been accessed or
            downloaded, except when required by applicable law or when Twilight
            Feather determines that an exception is appropriate.
          </p>
          <h3 className="mt-6 text-lg font-extrabold text-brand-charcoal">
            Online reader
          </h3>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Children Diseases: Sickle Cell and Children Diseases: Asthma are
            provided through Twilight Feather&apos;s protected online reader and
            are intended to be read in a web browser. These books are not
            provided as downloadable or offline PDFs.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            4. Duplicate purchases
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            If you accidentally purchase the same book more than once, please
            contact us within 14 days. After verifying the duplicate
            transaction, we may refund the duplicate purchase.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            5. Change-of-mind purchases
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            We generally do not issue refunds simply because you changed your
            mind, no longer want the book, or purchased the wrong product after
            completing checkout.
          </p>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            If you are unsure which product is right for you, please review the
            product information before purchasing or contact us before
            completing your order.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            6. How to request a refund
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            To request a refund, contact:
          </p>
          <p className="mt-2 break-all leading-relaxed text-brand-charcoal/80">
            <a
              href="mailto:hello.childrendiseases@gmail.com"
              className="font-semibold text-brand-green-deep underline underline-offset-2"
            >
              hello.childrendiseases@gmail.com
            </a>
          </p>
          <p className="mt-3 leading-relaxed text-brand-charcoal/80">
            Please include:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-brand-charcoal/80">
            <li>Your name</li>
            <li>The email address used for the purchase</li>
            <li>The name of the book or product</li>
            <li>The approximate purchase date</li>
            <li>A brief description of the issue</li>
            <li>
              Your Stripe receipt or transaction information, if available
            </li>
          </ul>
          <p className="mt-3 leading-relaxed text-brand-charcoal/80">
            Please do not send credit-card numbers, CVC codes, passwords, or
            other sensitive payment information.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            7. Review and processing
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            We review refund requests individually. If a refund is approved, it
            will generally be issued to the original payment method through our
            payment processor.
          </p>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Processing time may depend on your bank or card issuer.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            8. Exceptions and applicable rights
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Nothing in this policy is intended to limit any rights or remedies
            that cannot legally be waived under applicable law.
          </p>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Twilight Feather may make reasonable exceptions when circumstances
            warrant.
          </p>
        </div>
      </PageSection>
    </main>
  );
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentQueueReviewCard } from "./ContentQueueReviewCard";

const noop = () => {};

const baseItem = {
  id: "6f24c7da-8054-46a5-8d25-93a431ce508d",
  platform: "instagram",
  category: "educational",
  audience: "parents",
  status: "needs_review",
  title: "Meet Amara—a curious girl",
  body: "Meet Amara—a curious girl who loves to ask questions.\n\nRead Children Diseases: Sickle Cell on twilight-feather.com\n\n#SickleCellAwareness #ChildrensBooks",
  cta: null,
  weeklyPlanId: null,
  createdAt: "2026-10-10T17:00:17.452Z",
};

const adminPreview = `/api/admin/marketing/assets/a87843a4-2f77-4626-880d-ddda9445ab09/image`;

test("needs_review card shows full caption, platform, status, and review controls", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl={adminPreview}
      showVisualPreview
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, /needs review/i);
  assert.match(html, /instagram/i);
  assert.match(html, /Meet Amara—a curious girl who loves to ask questions/);
  assert.match(html, /#SickleCellAwareness/);
  assert.match(html, /Full caption/);
  assert.match(html, /Approve/);
  assert.match(html, /Reject/);
  assert.match(html, /does not schedule or publish|planner/i);
  assert.match(html, /api\/admin\/marketing\/assets\/a87843a4-2f77-4626-880d-ddda9445ab09\/image/);
  assert.doesNotMatch(html, /blob\.vercel-storage/);
});

test("approved content shows Add to Planner and hides Approve/Reject", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={{ ...baseItem, status: "approved" }}
      previewUrl={adminPreview}
      showVisualPreview
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.doesNotMatch(html, />Approve</);
  assert.doesNotMatch(html, />Reject</);
  assert.match(html, /Add to Planner/);
});

test("plannerQueued content shows In planner badge and planner link", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={{ ...baseItem, status: "approved", plannerQueued: true }}
      previewUrl={null}
      showVisualPreview={false}
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, /In planner/i);
  assert.match(html, /planning-queue/);
  assert.doesNotMatch(html, /Add to Planner/);
});

test("raw blob preview URL is not rendered; unavailable fallback shown", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl="https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/abc.png"
      showVisualPreview
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, /not allowed for in-browser review/i);
  assert.doesNotMatch(html, /blob\.vercel-storage/);
  assert.doesNotMatch(html, /Q7Bbz4IQuVq0GO24/);
});

const publicBlob =
  "https://q7bbz4iquvq0go24.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";

test("preview read-only card renders an explicit public Blob URL", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl={publicBlob}
      showVisualPreview
      allowPublicBlobPreview
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, new RegExp(publicBlob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.doesNotMatch(html, /api\/admin\/marketing\/assets\//);
});

test("invalid public Blob URL stays on the review fallback when preview images are allowed", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl="https://example.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
      showVisualPreview
      allowPublicBlobPreview
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, /not an allowed public marketing Blob/i);
  assert.doesNotMatch(html, /example\.com/);
});

test("preview read-only hides approve, reject, and week controls but keeps caption", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl={adminPreview}
      showVisualPreview
      previewReadonlyMode
      plans={[{ id: "plan-1", weekStart: "2026-10-13" }]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.doesNotMatch(html, />Approve</);
  assert.doesNotMatch(html, />Reject</);
  assert.doesNotMatch(html, /Add to Week/);
  assert.match(html, /read-only/i);
  assert.match(html, /Full caption/);
  assert.match(html, /#SickleCellAwareness/);
});

test("caption line breaks are preserved in markup", () => {
  const html = renderToStaticMarkup(
    <ContentQueueReviewCard
      item={baseItem}
      previewUrl={null}
      showVisualPreview={false}
      plans={[]}
      currentWeekPlanId={null}
      busy={false}
      onApprove={noop}
      onReject={noop}
      onAddToPlanner={noop}
    />,
  );
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /twilight-feather\.com/);
});

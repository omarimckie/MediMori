import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingPageGuide } from "./MarketingPageGuide";

test("guide renders supplied content when expanded", () => {
  const html = renderToStaticMarkup(
    <MarketingPageGuide id="content" initialExpanded />,
  );
  assert.match(html, /About this page/);
  assert.match(html, /What you should do here/);
  assert.match(html, /Good to know/);
  assert.match(html, /Inventory and staging area/);
  assert.match(html, /does not mean a post is scheduled or published/);
});

test("guide is collapsed by default with accessible button state", () => {
  const html = renderToStaticMarkup(<MarketingPageGuide id="analytics" />);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /type="button"/);
  assert.doesNotMatch(html, /Purchase attribution/);
});

test("expanded analytics guide includes Meta Insights limitation", () => {
  const html = renderToStaticMarkup(
    <MarketingPageGuide id="analytics" initialExpanded />,
  );
  assert.match(html, /does not ingest live Facebook or Instagram Meta Insights/);
});

export function JsonLd({ data }: { data: unknown }) {
  // Content is built from our own database values and escaped so it cannot close the script tag.
  const json = JSON.stringify(data).replace(/</g, "\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

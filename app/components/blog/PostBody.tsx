type PostBodyProps = {
  /** HTML produced at build time by the blog pipeline. */
  html: string;
};

/** Rendered article body. Styles come from the hand-written `.bl-prose` rules. */
export function PostBody({ html }: PostBodyProps) {
  return <div className="bl-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

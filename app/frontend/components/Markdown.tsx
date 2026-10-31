import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toMarkdownMath } from "@/lib/parse";

// caret: show a blinking write position at the end while the model is still writing this text
export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  return (
    <div className={`md ${caret ? "has-caret" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}>
        {toMarkdownMath(text)}
      </ReactMarkdown>
    </div>
  );
}

// A short answer like "p-q" shown as boxed math.
export function MathAnswer({ answer }: { answer: string }) {
  return <Markdown text={`$\\boxed{${answer}}$`} />;
}

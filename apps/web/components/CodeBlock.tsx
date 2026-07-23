"use client";

import { useCallback, useState } from "react";

interface CodeBlockProps {
  code: string;
  className?: string;
}

/** Code block with a copy-to-clipboard button that appears on hover. */
export function CodeBlock({ code, className = "" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silent fail
    }
  }, [code]);

  return (
    <div className={`op-code-wrap ${className}`.trim()}>
      <pre className="op-code">{code}</pre>
      <button
        type="button"
        className={`op-code-copy${copied ? " op-code-copy--ok" : ""}`}
        onClick={onCopy}
        aria-label="Copy code to clipboard"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

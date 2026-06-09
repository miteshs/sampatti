// A tiny, dependency-free markdown renderer — enough for the analysis output (headings,
// bold, inline code, ordered/unordered lists, paragraphs). Avoids pulling in a parser.

import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] != null) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<code key={k++}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) { blocks.push(<p key={key++}>{inline(para.join(" "))}</p>); para = []; }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    const ol = /^\d+[.)]\s+(.*)/.exec(line);
    const ul = /^[-*]\s+(.*)/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lvl = h[1].length;
      const Tag = (`h${Math.min(lvl + 1, 4)}`) as "h2" | "h3" | "h4";
      blocks.push(<Tag key={key++}>{inline(h[2])}</Tag>);
    } else if (ol || ul) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ol ?? ul)![1]);
    } else if (line === "") {
      flushPara(); flushList();
    } else {
      para.push(line);
    }
  }
  flushPara(); flushList();

  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}

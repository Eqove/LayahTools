/**
 * XML helpers built on @xmldom/xmldom.
 *
 * xmldom does not reliably throw on malformed input: it reports problems through an error
 * handler and may still return a partial tree. So every parse installs an explicit handler,
 * treats `error`/`fatalError` as failure, and only surfaces `warning` entries to the caller.
 */

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { DocxErrors, toDocxError } from "./errors";
import type { DocxWarning } from "./types";

export interface ParsedXml {
  document: Document;
  warnings: DocxWarning[];
}

type XmlIssueLevel = "warning" | "error" | "fatalError";

interface XmlIssue {
  level: XmlIssueLevel;
  message: string;
}

const normaliseLevel = (level: string): XmlIssueLevel =>
  level === "warning" ? "warning" : level === "fatalError" ? "fatalError" : "error";

const issueText = (message: unknown): string =>
  typeof message === "string" ? message : String(message ?? "unknown XML error");

const isNameChar = (char: string): boolean => !/[\s<>/=]/.test(char);

const readName = (source: string, start: number): { name: string; end: number } | null => {
  let index = start;
  while (index < source.length && isNameChar(source[index])) index++;
  return index > start ? { name: source.slice(start, index), end: index } : null;
};

/** Finds the `>` that closes a tag, skipping over quoted attribute values. */
const findTagEnd = (source: string, from: number): number => {
  let quote: string | null = null;
  for (let index = from; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
};

/**
 * Tag-balance scan run before the DOM parser.
 *
 * xmldom 0.8.x silently repairs several classes of malformed XML: mismatched closing tags are
 * auto-closed, stray closers are dropped, and `<a><b><c></b></c></a>` is reported as valid with
 * no error and no warning. This scan makes those cases deterministic failures instead.
 * It is a structural check only; lexical rules stay with xmldom.
 */
function findWellFormednessProblem(source: string): string | null {
  const stack: string[] = [];
  let sawRoot = false;
  let rootClosed = false;
  let index = 0;

  while (index < source.length) {
    const nextTag = source.indexOf("<", index);
    const text = nextTag === -1 ? source.slice(index) : source.slice(index, nextTag);
    if (text.trim().length > 0 && (!sawRoot || rootClosed)) {
      return "text outside the root element";
    }
    if (nextTag === -1) break;
    index = nextTag;

    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) return "unterminated comment";
      index = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index + 9);
      if (end === -1) return "unterminated CDATA section";
      if (stack.length === 0) return "CDATA outside the root element";
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end === -1) return "unterminated processing instruction";
      index = end + 2;
      continue;
    }
    if (source.startsWith("<!", index)) {
      const tagEnd = findTagEnd(source, index + 2);
      if (tagEnd === -1) return "unterminated declaration";
      const subsetStart = source.indexOf("[", index);
      if (subsetStart !== -1 && subsetStart < tagEnd) {
        const subsetEnd = source.indexOf("]>", subsetStart);
        if (subsetEnd === -1) return "unterminated DOCTYPE subset";
        index = subsetEnd + 2;
      } else {
        index = tagEnd + 1;
      }
      continue;
    }

    if (source[index + 1] === "/") {
      const closing = readName(source, index + 2);
      if (!closing) return "malformed closing tag";
      const tagEnd = findTagEnd(source, closing.end);
      if (tagEnd === -1) return "unterminated closing tag";
      if (source.slice(closing.end, tagEnd).trim().length > 0) {
        return `malformed closing tag </${closing.name}>`;
      }
      const open = stack.pop();
      if (!open) return `unexpected closing tag </${closing.name}>`;
      if (open !== closing.name) {
        return `closing tag </${closing.name}> does not match <${open}>`;
      }
      if (stack.length === 0) rootClosed = true;
      index = tagEnd + 1;
      continue;
    }

    const opening = readName(source, index + 1);
    if (!opening) return "malformed opening tag";
    if (stack.length === 0) {
      if (sawRoot) return "more than one root element";
      sawRoot = true;
    }
    const tagEnd = findTagEnd(source, opening.end);
    if (tagEnd === -1) return "unterminated opening tag";
    const selfClosing = source[tagEnd - 1] === "/";
    index = tagEnd + 1;
    if (selfClosing) {
      if (stack.length === 0) rootClosed = true;
    } else {
      stack.push(opening.name);
    }
  }

  if (stack.length > 0) return `unclosed element <${stack[stack.length - 1]}>`;
  if (!sawRoot) return "no root element";
  return null;
}

/**
 * Parses XML and fails loudly.
 *
 * Runs the tag-balance scan first, then parses with an explicit error handler that treats
 * `error`/`fatalError` as failure. Returns warnings for recoverable problems and throws
 * `CORRUPTED_PACKAGE` otherwise, keeping the parser's own messages in `detail`.
 */
export function parseXml(source: string, context = "XML"): ParsedXml {
  const structuralProblem = findWellFormednessProblem(source);
  if (structuralProblem) {
    throw DocxErrors.corruptedPackage(`${context} is not well-formed XML.`, structuralProblem);
  }

  const issues: XmlIssue[] = [];
  const parser = new DOMParser({
    errorHandler: (level, message) => {
      issues.push({ level: normaliseLevel(level), message: issueText(message) });
    },
  });

  let document: Document | null = null;
  let thrown: unknown = null;
  try {
    document = parser.parseFromString(source, "text/xml");
  } catch (error) {
    thrown = error;
  }

  const failures = issues.filter((issue) => issue.level !== "warning");
  if (thrown !== null || !document || !document.documentElement || failures.length > 0) {
    const detail = failures.length
      ? failures.map((issue) => issue.message).join("; ")
      : thrown !== null
        ? toDocxError(thrown).detail
        : "no document element";
    throw DocxErrors.corruptedPackage(`${context} is not well-formed XML.`, detail);
  }

  return {
    document,
    warnings: issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => ({ code: "XML_WARNING", message: issue.message })),
  };
}

/**
 * Serialises a parsed document back to XML.
 *
 * `requireWellFormed` is left off so that documents containing unusual but valid Word
 * constructs still round-trip; structural problems are caught by the caller's own checks.
 */
export function serializeXml(document: Document): string {
  if (!document || !document.documentElement) {
    throw DocxErrors.unsupportedStructure("Cannot serialise an empty XML document.");
  }

  let xml: string;
  try {
    xml = new XMLSerializer().serializeToString(document);
  } catch (error) {
    throw DocxErrors.processingFailure("The XML document could not be serialised.", toDocxError(error).detail);
  }

  if (!xml) {
    throw DocxErrors.processingFailure("The XML document serialised to an empty string.");
  }
  return xml;
}

/**
 * Serialises one element, including any namespace declarations xmldom needs to keep it
 * self-contained. Used to compare style definitions without caring about the document they
 * were parsed from.
 */
export function serializeXmlElement(element: Element): string {
  if (!element) {
    throw DocxErrors.unsupportedStructure("Cannot serialise an empty XML element.");
  }

  let xml: string;
  try {
    xml = new XMLSerializer().serializeToString(element);
  } catch (error) {
    throw DocxErrors.processingFailure(
      "The XML element could not be serialised.",
      toDocxError(error).detail
    );
  }

  if (!xml) {
    throw DocxErrors.processingFailure("The XML element serialised to an empty string.");
  }
  return xml;
}

/** First element with the given namespace and local name, or undefined. */
export function findElement(
  document: Document,
  namespace: string,
  localName: string
): Element | undefined {
  const match = document.getElementsByTagNameNS(namespace, localName);
  return match.length > 0 ? match[0] : undefined;
}

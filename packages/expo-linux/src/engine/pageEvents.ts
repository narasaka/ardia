const BLANK = "about:blank";

type Fields = Record<string, unknown>;

type BlankPage = "opening" | "asked";

export type OpeningPage = { blank: BlankPage; committed: boolean; downloaded: boolean };

const isBlank = (url: unknown) => url === "" || url === BLANK;

const asksForBlank = (url: unknown) => typeof url === "string" && url.startsWith("about:");

export const openingPage = (url: string): OpeningPage => ({ blank: asksForBlank(url) ? "asked" : "opening", committed: false, downloaded: false });

export function noteLoadAsked(page: OpeningPage, url: unknown) {
  page.downloaded = false;
  if (asksForBlank(url)) page.blank = "asked";
}

function shapedNavigation(page: OpeningPage, fields: Fields): Fields {
  if (typeof fields.committedUrl === "string" && !isBlank(fields.committedUrl)) page.committed = true;
  if (page.committed) return fields;
  const leftByDownload = page.downloaded && fields.isLoading === false;
  if (page.blank === "asked") return leftByDownload && fields.url === "" ? { ...fields, url: BLANK, title: BLANK } : fields;
  return {
    ...fields,
    url: leftByDownload || isBlank(fields.url) ? "" : fields.url,
    title: leftByDownload || fields.title === BLANK ? "" : fields.title,
    committedInitial: true,
    initialDocumentAccessed: false,
  };
}

function shapedDownload(page: OpeningPage, fields: Fields): Fields {
  if (page.committed) return fields;
  page.downloaded = true;
  if (page.blank === "asked") return fields.committedUrl === "" ? { ...fields, committedUrl: BLANK } : fields;
  return { ...fields, committedUrl: "" };
}

export function shapedPageEvent(page: OpeningPage, name: string, data: unknown): unknown {
  const fields = (data ?? {}) as Fields;
  if (name === "navigation") return shapedNavigation(page, fields);
  if (name === "downloadNavigation") return shapedDownload(page, fields);
  return data;
}

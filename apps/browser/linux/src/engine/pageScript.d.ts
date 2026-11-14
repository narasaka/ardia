declare module "*/page_script.js" {
  const pageScript: (post: (kind: string, json: string) => void) => (kind: string, json: string) => void;
  export default pageScript;
}

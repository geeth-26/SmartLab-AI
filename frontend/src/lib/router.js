// Minimal hash router: "#/documents/12?page=3" -> { path: ["documents", "12"], query: {page: "3"} }.
// Hash routing keeps deep links and the back button working without server configuration.
import { useEffect, useState } from "react";

function parse() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  return {
    path: pathPart.split("/").filter(Boolean).map(decodeURIComponent),
    query: Object.fromEntries(new URLSearchParams(queryPart)),
  };
}

export function navigate(to, { replace = false } = {}) {
  const target = `#/${to.replace(/^#?\/?/, "")}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

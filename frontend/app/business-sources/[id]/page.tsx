import { redirect } from "next/navigation";

// Keep existing bookmarks pointing to the renamed module.
export default function RedirectPage() { redirect("/business-sources"); }

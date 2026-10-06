"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** "New dashboard" is the docked editor on the list (?edit=new); this route keeps
 * old links and the ⌘K "New dashboard" command working. */
export default function NewDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboards?edit=new");
  }, [router]);
  return null;
}

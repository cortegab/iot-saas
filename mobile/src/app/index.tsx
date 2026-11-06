import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";

/** Where the app opens: the dashboards when signed in, else sign-in. */
export default function Index() {
  const { status } = useAuth();
  return <Redirect href={status === "authenticated" ? "/dashboards" : "/sign-in"} />;
}

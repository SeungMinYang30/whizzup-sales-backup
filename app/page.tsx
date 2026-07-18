import CrmApp from "./crm-app";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const identity = await requireChatGPTUser("/");
  return (
    <CrmApp
      identity={{
        email: identity.email,
        displayName: identity.displayName,
      }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}

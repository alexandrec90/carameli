// Fixture for the fix-e2e eval task. The dashboard route has a typo ("/dahsboard")
// that makes the navigation spec fail. The fix corrects it to "/dashboard". Lives
// under evals/fixtures so Playwright/Vite never collect it. Leave it broken.
export const routes = {
  dashboard: "/dahsboard",
  settings: "/settings",
};

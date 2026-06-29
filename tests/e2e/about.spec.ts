import { expect, test } from "@playwright/test";

test("About page renders its content and is reachable from the header nav", async ({ page }) => {
  await page.goto("/about");

  // The page renders (no 404) with its mission heading.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Restaurants you can actually trust to be gluten-free.",
    })
  ).toBeVisible();

  // Each of the four required content sections renders as a semantic heading.
  await expect(page.getByRole("heading", { name: "Our mission" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How trust works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the community attests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to contribute" })).toBeVisible();
});

test("header About nav link resolves to the About route", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" });
  const aboutLink = nav.getByRole("link", { name: "About" });
  await expect(aboutLink).toHaveAttribute("href", "/about");

  await aboutLink.click();
  await expect(page).toHaveURL("/about");
  await expect(page.getByRole("heading", { name: "Our mission" })).toBeVisible();
});

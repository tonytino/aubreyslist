import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

export const exampleRoutes = new Hono()
  .get("/", (c) => {
    return c.json({ message: "Hello from Hono" });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1),
      })
    ),
    (c) => {
      const { name } = c.req.valid("json");
      return c.json({ message: `Hello, ${name}` });
    }
  );

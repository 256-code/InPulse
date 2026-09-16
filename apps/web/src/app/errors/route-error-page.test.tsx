import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RouteErrorPage } from "./RouteErrorPage";

describe("RouteErrorPage", () => {
  it("renders a branded 404 instead of the router developer page", async () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: <p>ok</p>,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
        errorElement: <RouteErrorPage />,
      },
    ]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId("route-error-page")).toBeInTheDocument();
    expect(screen.getByText("页面不存在")).toBeInTheDocument();
    expect(screen.queryByText(/Hey developer/u)).not.toBeInTheDocument();
  });

  it("falls back to a generic failure page for unexpected errors", async () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: <p>ok</p>,
        loader: () => {
          throw new Error("boom");
        },
        errorElement: <RouteErrorPage />,
      },
    ]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("页面加载失败")).toBeInTheDocument();
  });
});

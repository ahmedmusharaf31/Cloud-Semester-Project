import { Link } from "react-router-dom";
import Page from "../components/Page";

export default function NotFound() {
  return (
    <Page>
      <div className="container-x flex flex-col items-center py-52 text-center">
        <p className="font-display text-[8rem] font-semibold leading-none tracking-tightest text-maroon-700">
          404
        </p>
        <h1 className="display-hero mt-4 text-3xl">
          This page wandered off the route table.
        </h1>
        <p className="mt-3 text-ink-soft">
          The ALB only knows so many paths, and this isn't one of them.
        </p>
        <Link to="/" className="btn-primary mt-7">
          Back home
        </Link>
      </div>
    </Page>
  );
}

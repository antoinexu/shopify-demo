import { NavLink, Link } from "react-router";

export function Header({ cartQuantity }: { cartQuantity: number }) {
  return (
    <header className="header">
      <Link to="/" className="brand">
        MERIDIAN
      </Link>

      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}>
          All products
        </NavLink>
        <NavLink to="/cart" className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}>
          Cart
          {cartQuantity > 0 ? <span className="badge">{cartQuantity}</span> : null}
        </NavLink>
      </nav>
    </header>
  );
}

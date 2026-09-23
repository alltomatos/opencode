import { type ComponentProps } from "solid-js"
import brandLogo from "../assets/images/brand-logo.png"

export const Mark = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      src={brandLogo}
      alt="OpenCode"
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      src={brandLogo}
      alt=""
    />
  )
}

export const Logo = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-full"
      classList={{ [props.class ?? ""]: !!props.class }}
      src={brandLogo}
      alt="OpenCode"
    />
  )
}

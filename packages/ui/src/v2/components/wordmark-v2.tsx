import { type ComponentProps } from "solid-js"
import brandLogo from "../../assets/images/brand-logo.png"

export function WordmarkV2(props: Pick<ComponentProps<"img">, "class">) {
  return <img classList={{ [props.class ?? ""]: !!props.class }} src={brandLogo} alt="" />
}

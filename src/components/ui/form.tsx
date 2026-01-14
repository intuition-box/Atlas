"use client";

import * as React from "react";
import { Form as FormPrimitive } from "@base-ui/react/form";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type RegisterOptions,
} from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

import { cn } from "@/lib/utils";

const Form = FormProvider;

/**
 * Base UI form element.
 *
 * This is the element that actually renders the <form> tag.
 */
function FormRoot({ className, ...props }: React.ComponentProps<typeof FormPrimitive>) {
  return (
    <FormPrimitive data-slot="form" className={cn("space-y-6", className)} {...props} />
  );
}

type FormFieldRenderArgs<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  id: string;
  field: ControllerRenderProps<TFieldValues, TName>;
  fieldState: ControllerFieldState;
};

type FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  name: TName;
  id?: string;
  required?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  rules?: RegisterOptions<TFieldValues, TName>;
  /**
   * Render the actual control.
   *
   * - For Base UI controls, prefer `onValueChange`.
   * - For native/standard inputs, use `onChange`.
   *
   * Use `fieldControlProps(field)` to get both.
   */
  render: (args: FormFieldRenderArgs<TFieldValues, TName>) => React.ReactNode;
} & Omit<
  React.ComponentProps<typeof Field>,
  "children" | "name" | "invalid" | "touched" | "dirty" | "render"
>;

/**
 * Base UI + React Hook Form field helper.
 *
 * It maps RHF Controller state onto Base UI's <Field> state so styling can
 * rely on `data-[invalid]`, `data-[touched]`, `data-[dirty]`, etc.
 */
function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(props: FormFieldProps<TFieldValues, TName>) {
  const { name, id, required, label, description, rules, render, ...rootProps } = props;
  const { control } = useFormContext<TFieldValues>();

  const reactId = React.useId();
  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, "-");
  const controlId = id ?? `field-${safeName}-${reactId}`;

  const inferredRequired = (() => {
    if (!rules || !("required" in rules)) return false;
    const req = (rules as { required?: unknown }).required;
    if (typeof req === "boolean") return req;
    if (typeof req === "string") return true;
    if (req && typeof req === "object" && "value" in (req as Record<string, unknown>)) {
      return Boolean((req as { value?: unknown }).value);
    }
    return Boolean(req);
  })();

  const isRequired = required ?? inferredRequired;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState }) => (
        <Field
          {...rootProps}
          name={field.name}
          invalid={fieldState.invalid}
          touched={fieldState.isTouched}
          dirty={fieldState.isDirty}
        >
          {label ? (
            <FieldLabel>
              {label}
              {isRequired ? (
                <span aria-hidden="true" className="text-destructive ml-1">
                  *
                </span>
              ) : null}
            </FieldLabel>
          ) : null}
          {description ? <FieldDescription>{description}</FieldDescription> : null}

          {render({ id: controlId, field, fieldState })}

          {fieldState.error ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : null}
        </Field>
      )}
    />
  );
}

function FormError({ className, ...props }: React.ComponentProps<"p">) {
  const {
    formState: { errors },
  } = useFormContext();

  const message =
    (errors as Record<string, unknown>)?.root &&
    typeof (errors as { root?: { message?: unknown } }).root?.message === "string"
      ? String((errors as { root?: { message?: unknown } }).root?.message)
      : null;

  if (!message) return null;

  return (
    <p
      data-slot="form-error"
      className={cn(
        "text-destructive rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm",
        className,
      )}
      {...props}
    >
      {message}
    </p>
  );
}

/**
 * Convenience helper for mapping RHF field props onto either:
 * - Base UI controls (use `onValueChange`)
 * - Native/standard inputs (use `onChange`)
 */
function fieldControlProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(
  field: ControllerRenderProps<TFieldValues, TName>,
  opts?: {
    id?: string;
    describedBy?: string;
    invalid?: boolean;
  },
) {
  return {
    id: opts?.id,
    name: field.name,
    ref: field.ref,
    value: field.value ?? "",
    onBlur: field.onBlur,
    onChange: field.onChange,
    onValueChange: field.onChange,
    "aria-describedby": opts?.describedBy,
    "aria-invalid": opts?.invalid,
  };
}

export {
  Form,
  FormRoot,
  FormField,
  FormError,
  fieldControlProps,
  type FormFieldRenderArgs,
  type FormFieldProps,
};

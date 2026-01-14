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
  field: ControllerRenderProps<TFieldValues, TName>;
  fieldState: ControllerFieldState;
};

type FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  name: TName;
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
  const { name, label, description, rules, render, ...rootProps } = props;
  const { control } = useFormContext<TFieldValues>();

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
          {label ? <FieldLabel>{label}</FieldLabel> : null}
          {description ? <FieldDescription>{description}</FieldDescription> : null}

          {render({ field, fieldState })}

          {fieldState.error ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : null}
        </Field>
      )}
    />
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
>(field: ControllerRenderProps<TFieldValues, TName>) {
  return {
    name: field.name,
    ref: field.ref,
    value: field.value ?? "",
    onBlur: field.onBlur,
    onChange: field.onChange,
    onValueChange: field.onChange,
  };
}

export {
  Form,
  FormRoot,
  FormField,
  fieldControlProps,
  type FormFieldRenderArgs,
  type FormFieldProps,
};

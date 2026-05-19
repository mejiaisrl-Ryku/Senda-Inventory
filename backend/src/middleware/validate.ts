import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const flat = result.error.flatten();
      return res.status(422).json({
        error: "Validation failed",
        // fieldErrors covers per-field issues; formErrors covers cross-field refine() failures.
        issues: Object.keys(flat.fieldErrors).length
          ? flat.fieldErrors
          : { _form: flat.formErrors },
      });
    }
    req.body = result.data;
    next();
  };
}

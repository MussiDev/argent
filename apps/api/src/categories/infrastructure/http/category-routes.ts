import {
  categoryIdParamsSchema,
  categoryResponseSchema,
  createCategoryRequestSchema,
  listCategoriesQuerySchema,
  listCategoriesResponseSchema,
  updateCategoryRequestSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessPolicy,
  type AccessScope,
} from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type { AuthContext } from '../../../shared/http/auth-context';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import { CreateCategory } from '../../application/create-category';
import { DeleteCategory } from '../../application/delete-category';
import { GetCategory } from '../../application/get-category';
import { ListCategories } from '../../application/list-categories';
import type { CategoryUsage } from '../../application/ports/category-usage';
import type { UpdateCategoryFields } from '../../application/ports/category-repository';
import { SetCategoryArchived } from '../../application/set-category-archived';
import { UpdateCategory } from '../../application/update-category';
import { DrizzleCategoryRepository } from '../db/drizzle-category-repository';
import { NoUsageAdapter } from '../usage/no-usage-adapter';
import { presentCategory, presentCategoryList } from './category-presenter';

export interface CategoryRoutesOptions {
  db: Database;
  /** Defaults to the adapter that reports no usage (until PRD 03). */
  usage?: CategoryUsage;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
}

/**
 * Every handler asks for a write scope: each use case first runs `ensureDefaults`, which may seed
 * the owner's defaults (the D9 safety net).
 */
function writeScope(
  policy: AccessPolicy,
  auth: AuthContext | undefined,
): Promise<AccessScope<'write'>> {
  // requireSession always sets auth before these routes; failing closed keeps that explicit.
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
  return policy.scopeFor(auth, 'write');
}

/** `/categories`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createCategoryRoutes({
  db,
  usage = new NoUsageAdapter(),
  logger,
}: CategoryRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const categories = new DrizzleCategoryRepository(db);
  const listCategories = new ListCategories({ categories });
  const getCategory = new GetCategory({ categories });
  const createCategory = new CreateCategory({ categories });
  const updateCategory = new UpdateCategory({ categories });
  const setArchived = new SetCategoryArchived({ categories });
  const deleteCategory = new DeleteCategory({ categories, usage });

  // Audit lines carry ids only: never a category name.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    id: string,
  ): void => {
    logger.info({ requestId, userId: auth?.userId, categoryId: id }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/categories', requireSession, requireVerifiedEmail);

    router.post(
      '/categories',
      validate(
        { body: createCategoryRequestSchema, response: categoryResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await writeScope(policy, auth);
          const created = await createCategory.execute(scope, {
            name: body.name,
            kind: body.kind,
            icon: body.icon,
            color: body.color,
            ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
          });
          audit('category created', requestId, auth, created.id);
          res.status(201).json(presentCategory(created));
        },
      ),
    );

    router.get(
      '/categories',
      validate(
        { query: listCategoriesQuerySchema, response: listCategoriesResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await writeScope(policy, auth);
          const list = await listCategories.execute(scope, {
            ...(query.kind !== undefined ? { kind: query.kind } : {}),
            archived: query.archived,
            limit: query.limit,
            offset: query.offset,
          });
          res.json(presentCategoryList(list, query));
        },
      ),
    );

    router.get(
      '/categories/:id',
      validate(
        { params: categoryIdParamsSchema, response: categoryResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await writeScope(policy, auth);
          res.json(presentCategory(await getCategory.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/categories/:id',
      validate(
        {
          params: categoryIdParamsSchema,
          body: updateCategoryRequestSchema,
          response: categoryResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await writeScope(policy, auth);
          const fields: UpdateCategoryFields = {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.icon !== undefined ? { icon: body.icon } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
          };
          const updated = await updateCategory.execute(scope, params.id, fields);
          audit('category updated', requestId, auth, updated.id);
          res.json(presentCategory(updated));
        },
      ),
    );

    for (const [action, archived, message] of [
      ['archive', true, 'category archived'],
      ['unarchive', false, 'category unarchived'],
    ] as const) {
      router.post(
        `/categories/:id/${action}`,
        validate(
          { params: categoryIdParamsSchema, response: categoryResponseSchema },
          async ({ params }, { res, auth, requestId }) => {
            const scope = await writeScope(policy, auth);
            const category = await setArchived.execute(scope, params.id, archived);
            audit(message, requestId, auth, category.id);
            res.json(presentCategory(category));
          },
        ),
      );
    }

    router.delete(
      '/categories/:id',
      validate({ params: categoryIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await writeScope(policy, auth);
        await deleteCategory.execute(scope, params.id);
        audit('category deleted', requestId, auth, params.id);
        res.sendStatus(204);
      }),
    );

    return router;
  };
}

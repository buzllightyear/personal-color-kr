'use client';

/**
 * RecipeForm — create/edit form covering all recipe fields.
 *
 * Fields (all from the Seed ontology)
 * ------------------------------------
 * recipe_id         — unique human-readable identifier (create only, disabled on edit)
 * model_id          — fal.ai model identifier
 * prompt_template   — prompt template with variable slots
 * style_reference_key — object-storage key or HTTPS URL for style reference image
 * parameters        — model-specific parameter set (JSON editor)
 * status            — initial status (hidden/published, create only)
 * publish_date      — ISO publish date for catalog
 * display_order     — featured-section sort weight
 *
 * Behaviour
 * ---------
 * - If ``recipe`` prop is provided: renders in edit mode, calls PUT on submit.
 * - If ``recipe`` is undefined: renders in create mode, calls POST on submit.
 * - The ``parameters`` field is a raw JSON textarea; invalid JSON shows an error.
 * - ``onSuccess`` is called with the returned Recipe on successful submit.
 * - ``onCancel`` is called when the operator clicks Cancel.
 *
 * Props
 * -----
 * token      — Bearer token for API calls.
 * recipe     — (Optional) existing recipe to edit.
 * onSuccess  — Called with the server-returned Recipe after save.
 * onCancel   — Called when operator cancels.
 */

import React, { useState, type FormEvent } from 'react';
import type { Recipe, RecipeCreate, RecipeStatus, RecipeUpdate } from '@/types/recipe';
import { ApiError, createRecipe, updateRecipe } from '@/lib/api';

// ---------------------------------------------------------------------------
// Form field helpers
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | null;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label htmlFor={htmlFor} style={{ fontSize: '0.875rem', fontWeight: 500 }}>
        {label}
      </label>
      {children}
      {error != null && (
        <span role="alert" style={{ color: '#c00', fontSize: '0.75rem' }}>
          {error}
        </span>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #ccc',
  borderRadius: '4px',
  fontSize: '0.9375rem',
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// RecipeForm
// ---------------------------------------------------------------------------

interface RecipeFormProps {
  token: string;
  recipe?: Recipe;
  onSuccess: (recipe: Recipe) => void;
  onCancel: () => void;
}

export default function RecipeForm({
  token,
  recipe,
  onSuccess,
  onCancel,
}: RecipeFormProps) {
  const isEdit = recipe !== undefined;

  // Controlled field state
  const [recipeId, setRecipeId] = useState(recipe?.recipe_id ?? '');
  const [modelId, setModelId] = useState(recipe?.model_id ?? '');
  const [promptTemplate, setPromptTemplate] = useState(recipe?.prompt_template ?? '');
  const [styleRefKey, setStyleRefKey] = useState(recipe?.style_reference_key ?? '');
  const [parametersRaw, setParametersRaw] = useState(
    recipe !== undefined ? JSON.stringify(recipe.parameters, null, 2) : '{}',
  );
  const [status, setStatus] = useState<RecipeStatus>(recipe?.status ?? 'hidden');
  const [publishDate, setPublishDate] = useState(
    recipe?.publish_date !== null && recipe?.publish_date !== undefined
      ? recipe.publish_date.substring(0, 16) // datetime-local format
      : '',
  );
  const [displayOrder, setDisplayOrder] = useState(String(recipe?.display_order ?? 0));
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [tagsRaw, setTagsRaw] = useState(recipe?.tags?.join(', ') ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(recipe?.thumbnail_url ?? '');

  // Validation / submit state
  const [paramError, setParamError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function validateParameters(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(parametersRaw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParamError('Parameters must be a JSON object (not an array or null)');
        return null;
      }
      setParamError(null);
      return parsed as Record<string, unknown>;
    } catch {
      setParamError('Invalid JSON — check syntax');
      return null;
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const parameters = validateParameters();
    if (parameters === null) return;

    const parsedOrder = parseInt(displayOrder, 10);
    if (isNaN(parsedOrder)) {
      setSubmitError('Display order must be an integer');
      return;
    }

    if (title.trim().length === 0) {
      setSubmitError('Title is required');
      return;
    }

    const parsedPublishDate = publishDate.length > 0 ? `${publishDate}:00Z` : null;

    const parsedTags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const parsedDescription = description.length > 0 ? description : null;
    const parsedThumbnailUrl = thumbnailUrl.length > 0 ? thumbnailUrl : null;

    setSaving(true);
    setSubmitError(null);

    try {
      let result: Recipe;
      if (isEdit && recipe !== undefined) {
        const body: RecipeUpdate = {
          model_id: modelId,
          prompt_template: promptTemplate,
          title,
          description: parsedDescription,
          tags: parsedTags,
          thumbnail_url: parsedThumbnailUrl,
          style_reference_key: styleRefKey.length > 0 ? styleRefKey : null,
          parameters,
          publish_date: parsedPublishDate,
          display_order: parsedOrder,
        };
        result = await updateRecipe(token, recipe.recipe_id, body);
      } else {
        const body: RecipeCreate = {
          recipe_id: recipeId,
          model_id: modelId,
          prompt_template: promptTemplate,
          title,
          description: parsedDescription,
          tags: parsedTags,
          thumbnail_url: parsedThumbnailUrl,
          style_reference_key: styleRefKey.length > 0 ? styleRefKey : null,
          parameters,
          status,
          publish_date: parsedPublishDate,
          display_order: parsedOrder,
        };
        result = await createRecipe(token, body);
      }
      onSuccess(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`Save failed: ${err.detail}`);
      } else {
        setSubmitError('Save failed — unexpected error');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        maxWidth: '640px',
      }}
      aria-label={isEdit ? 'Edit recipe' : 'Create recipe'}
    >
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        {isEdit ? `Edit: ${recipe?.recipe_id}` : 'New Recipe'}
      </h2>

      {/* recipe_id — only editable on create */}
      <Field label="Recipe ID *" htmlFor="field-recipe-id">
        <input
          id="field-recipe-id"
          type="text"
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
          disabled={isEdit}
          required={!isEdit}
          placeholder="e.g. summer-glow-2026"
          style={{
            ...inputStyle,
            background: isEdit ? '#f3f4f6' : '#fff',
            cursor: isEdit ? 'not-allowed' : 'text',
          }}
        />
      </Field>

      {/* title */}
      <Field label="Title *" htmlFor="field-title">
        <input
          id="field-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. 투명 글로우 메이크업"
          style={inputStyle}
        />
      </Field>

      {/* model_id */}
      <Field label="Model ID *" htmlFor="field-model-id">
        <input
          id="field-model-id"
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          required
          placeholder="e.g. fal-ai/flux/dev/image-to-image"
          style={inputStyle}
        />
      </Field>

      {/* prompt_template */}
      <Field label="Prompt Template *" htmlFor="field-prompt">
        <textarea
          id="field-prompt"
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          required
          rows={4}
          placeholder="Portrait of a {personal_color} person in summer lighting…"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      {/* style_reference_key */}
      <Field label="Style Reference (URL or storage key)" htmlFor="field-style-ref">
        <input
          id="field-style-ref"
          type="text"
          value={styleRefKey}
          onChange={(e) => setStyleRefKey(e.target.value)}
          placeholder="https://cdn.example.com/style-ref.jpg or r2://bucket/key"
          style={inputStyle}
        />
      </Field>

      {/* description */}
      <Field label="Description" htmlFor="field-description">
        <input
          id="field-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="조명 없이도 맑아지는 피부"
          style={inputStyle}
        />
      </Field>

      {/* tags (comma-separated) */}
      <Field label="Tags (comma-separated)" htmlFor="field-tags">
        <input
          id="field-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="뷰티보정, HOT"
          style={inputStyle}
        />
      </Field>

      {/* thumbnail_url (public HTTPS URL) */}
      <Field label="Thumbnail URL" htmlFor="field-thumbnail">
        <input
          id="field-thumbnail"
          type="text"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          placeholder="https://cdn.example.com/thumb.png"
          style={inputStyle}
        />
      </Field>

      {/* parameters (JSON) */}
      <Field label="Parameters (JSON)" htmlFor="field-parameters" error={paramError}>
        <textarea
          id="field-parameters"
          value={parametersRaw}
          onChange={(e) => setParametersRaw(e.target.value)}
          rows={6}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
          aria-invalid={paramError !== null ? true : undefined}
        />
      </Field>

      {/* status — only on create */}
      {!isEdit && (
        <Field label="Initial Status" htmlFor="field-status">
          <select
            id="field-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as RecipeStatus)}
            style={inputStyle}
          >
            <option value="hidden">Hidden (default)</option>
            <option value="published">Published</option>
          </select>
        </Field>
      )}

      {/* publish_date */}
      <Field label="Publish Date" htmlFor="field-publish-date">
        <input
          id="field-publish-date"
          type="datetime-local"
          value={publishDate}
          onChange={(e) => setPublishDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {/* display_order */}
      <Field label="Display Order" htmlFor="field-display-order">
        <input
          id="field-display-order"
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {submitError !== null && (
        <p role="alert" style={{ color: '#c00', fontSize: '0.875rem' }}>
          {submitError}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '0.5rem 1.25rem',
            background: '#000',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '0.9375rem',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Recipe'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: '0.5rem 1.25rem',
            background: '#fff',
            color: '#000',
            border: '1px solid #000',
            borderRadius: '4px',
            fontSize: '0.9375rem',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

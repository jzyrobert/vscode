/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { VIEWLET_ID } from 'vs/workbench/contrib/files/common/files';
import { TextFileModelChangeEvent, ITextFileService, AutoSaveMode, ModelState } from 'vs/workbench/services/textfile/common/textfiles';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import * as arrays from 'vs/base/common/arrays';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkingCopyService, IWorkingCopy, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';

export class DirtyFilesTracker extends Disposable implements IWorkbenchContribution {
	private readonly badgeHandle = this._register(new MutableDisposable());

	private lastKnownDirtyCount: number | undefined;

	private get hasDirtyCount(): boolean {
		return typeof this.lastKnownDirtyCount === 'number' && this.lastKnownDirtyCount > 0;
	}

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IEditorService private readonly editorService: IEditorService,
		@IActivityService private readonly activityService: IActivityService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Local text file changes
		this._register(this.textFileService.models.onModelsDirty(e => this.onTextFilesDirty(e)));

		// Working copy dirty indicator
		this._register(this.workingCopyService.onDidChangeDirty(c => this.onWorkingCopyDidChangeDirty(c)));

		// Lifecycle
		this.lifecycleService.onShutdown(this.dispose, this);
	}

	private onWorkingCopyDidChangeDirty(copy: IWorkingCopy): void {
		if (!!(copy.capabilities & WorkingCopyCapabilities.AutoSave) && this.textFileService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
			return; // do not indicate changes to working copies that are auto saved after short delay
		}

		const gotDirty = copy.isDirty();
		if (gotDirty || this.hasDirtyCount) {
			this.updateActivityBadge();
		}
	}

	private onTextFilesDirty(e: readonly TextFileModelChangeEvent[]): void {

		// If files become dirty but are not opened, we open it in the background unless there are pending to be saved
		this.doOpenDirtyResources(arrays.distinct(e.filter(e => {

			// Only dirty models that are not PENDING_SAVE
			const model = this.textFileService.models.get(e.resource);
			const shouldOpen = model?.isDirty() && !model.hasState(ModelState.PENDING_SAVE);

			// Only if not open already
			return shouldOpen && !this.editorService.isOpen({ resource: e.resource });
		}).map(e => e.resource), r => r.toString()));
	}

	private doOpenDirtyResources(resources: URI[]): void {

		// Open
		this.editorService.openEditors(resources.map(resource => {
			return {
				resource,
				options: { inactive: true, pinned: true, preserveFocus: true }
			};
		}));
	}

	private updateActivityBadge(): void {
		const dirtyCount = this.workingCopyService.dirtyCount;
		this.lastKnownDirtyCount = dirtyCount;

		// Indicate dirty count in badge if any
		if (dirtyCount > 0) {
			this.badgeHandle.value = this.activityService.showActivity(
				VIEWLET_ID,
				new NumberBadge(dirtyCount, num => num === 1 ? nls.localize('dirtyFile', "1 unsaved file") : nls.localize('dirtyFiles', "{0} unsaved files", dirtyCount)),
				'explorer-viewlet-label'
			);
		} else {
			this.badgeHandle.clear();
		}
	}
}

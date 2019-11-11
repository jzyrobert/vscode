/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { Disposable, IDisposable, toDisposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { TernarySearchTree } from 'vs/base/common/map';

export interface IWorkingCopy {

	//#region Dirty Tracking

	readonly onDidChangeDirty: Event<void>;

	isDirty(): boolean;

	//#endregion

	readonly resource: URI;
}

export const IWorkingCopyService = createDecorator<IWorkingCopyService>('workingCopyService');

export interface IWorkingCopyService {

	_serviceBrand: undefined;

	//#region Dirty Tracking

	readonly onDidChangeDirty: Event<IWorkingCopy>;

	readonly dirtyCount: number;

	isDirty(resource: URI): boolean;

	//#endregion


	//#region Registry

	registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable;

	//#endregion
}

export class WorkingCopyService extends Disposable implements IWorkingCopyService {

	_serviceBrand: undefined;

	//#region Dirty Tracking

	private readonly _onDidChangeDirty = this._register(new Emitter<IWorkingCopy>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	isDirty(resource: URI): boolean {
		const workingCopies = this.mapResourceToWorkingCopy.get(resource.toString());
		if (workingCopies) {
			for (const workingCopy of workingCopies) {
				if (workingCopy.isDirty()) {
					return true;
				}
			}
		}

		return false;
	}

	get dirtyCount(): number {
		let totalDirtyCount = 0;

		this.mapResourceToWorkingCopy.forEach(workingCopies => {
			for (const workingCopy of workingCopies) {
				if (workingCopy.isDirty()) {
					totalDirtyCount++;
				}
			}
		});

		return totalDirtyCount;
	}

	//#endregion


	//#region Registry

	private mapResourceToWorkingCopy = TernarySearchTree.forPaths<Set<IWorkingCopy>>();

	registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable {
		const disposables = new DisposableStore();

		// Registry
		let workingCopiesForResource = this.mapResourceToWorkingCopy.get(workingCopy.resource.toString());
		if (!workingCopiesForResource) {
			workingCopiesForResource = new Set<IWorkingCopy>();
			this.mapResourceToWorkingCopy.set(workingCopy.resource.toString(), workingCopiesForResource);
		}

		if (!workingCopiesForResource.has(workingCopy)) {
			workingCopiesForResource.add(workingCopy);
		}

		// Dirty Events
		disposables.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));

		return toDisposable(() => {
			this.unregisterWorkingCopy(workingCopy);
			dispose(disposables);
		});
	}

	private unregisterWorkingCopy(workingCopy: IWorkingCopy): void {

		// Remove from registry
		const workingCopiesForResource = this.mapResourceToWorkingCopy.get(workingCopy.resource.toString());
		if (workingCopiesForResource && workingCopiesForResource.delete(workingCopy) && workingCopiesForResource.size === 0) {
			this.mapResourceToWorkingCopy.delete(workingCopy.resource.toString());
		}

		// If copy is dirty, ensure to fire an event to signal the dirty change
		// (a disposed working copy cannot account for being dirty in our model)
		if (workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}
	}

	//#endregion
}

registerSingleton(IWorkingCopyService, WorkingCopyService, true);

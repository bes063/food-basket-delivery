import { Component, OnInit, ViewChild } from '@angular/core';
import { Column, Entity, ServerFunction, IdColumn, SqlDatabase, StringColumn } from '@remult/core';
import { Context } from '@remult/core';
import { Helpers } from '../helpers/helpers';
import { HasAsyncGetTheValue } from '../model-shared/types';

import { Families, parseAddress, duplicateFamilyInfo } from '../families/families';

import { BasketType } from '../families/BasketType';
import { FamilySources } from '../families/FamilySources';
import { DeliveryStatus } from '../families/DeliveryStatus';
import { DialogService } from '../select-popup/dialog';
import { BusyService } from '@remult/core';


import { Roles } from '../auth/roles';
import { MatStepper } from '@angular/material';

import { ApplicationSettings } from '../manage/ApplicationSettings';
import { translate } from '../translate';
import { UpdateFamilyDialogComponent } from '../update-family-dialog/update-family-dialog.component';
import { Groups } from '../manage/manage.component';

@Component({
    selector: 'app-excel-import',
    templateUrl: './import-from-excel.component.html',
    styleUrls: ['./import-from-excel.component.scss']
})
export class ImportFromExcelComponent implements OnInit {



    constructor(private context: Context, private dialog: DialogService, private busy: BusyService) {

    }
    updateRowsPage: number;
    existingFamiliesPage: number;
    errorRowsPage: number;
    excelPage: number;
    newRowsPage: number;
    cell: string;

    oFile: import('xlsx').WorkBook;
    worksheet: import('xlsx').WorkSheet;

    excelColumns: excelColumn[] = [];
    additionalColumns: additionalColumns[] = [];
    columns: columnUpdater[] = [];

    rows: number[] = [];

    getData() {
        return this.getTheData(this.cell);
    }
    getTheData(cell: string) {
        let val = this.worksheet[cell];
        if (!val || !val.w)
            return '';
        return val.w.trim();
    }
    columnsInCompare: Column<any>[] = [];

    totalRows: number;
    filename: string;


    getColInfo(i: excelRowInfo, col: Column<any>) {
        return ImportFromExcelComponent.actualGetColInfo(i, col.defs.key);
    }
    static actualGetColInfo(i: excelRowInfo, colMemberName: string) {
        let r = i.values[colMemberName];
        if (!r) {
            r = {
                newDisplayValue: '',
                existingDisplayValue: '',
                newValue: ''
            };
            //  i.values.push(r);
        }
        return r;
    }

    async addAll() {
        let count = this.newRows.length;
        this.dialog.YesNoQuestion("האם להוסיף " + count + translate(" משפחות?"), () => {
            this.busy.doWhileShowingBusy(async () => {
                let rowsToInsert: excelRowInfo[] = [];

                let lastDate = new Date().valueOf();
                for (const i of this.newRows) {

                    rowsToInsert.push(i);


                    if (rowsToInsert.length == 35) {
                        await ImportFromExcelComponent.insertRows(rowsToInsert);
                        if (new Date().valueOf() - lastDate > 1000) {
                            this.dialog.Info(i.rowInExcel + ' ' + (i.name));
                        }
                        this.identicalRows.push(...rowsToInsert);
                        rowsToInsert = [];
                    }



                }
                if (rowsToInsert.length > 0) {
                    await ImportFromExcelComponent.insertRows(rowsToInsert);
                    this.identicalRows.push(...rowsToInsert);
                }
                this.newRows = [];
                this.identicalRows.sort((a, b) => a.rowInExcel - b.rowInExcel);
            });
        });
    }
    @ServerFunction({ allowed: Roles.admin })
    static async insertRows(rowsToInsert: excelRowInfo[], context?: Context) {
        for (const r of rowsToInsert) {
            let f = context.for(Families).create();
            for (const val in r.values) {
                f.columns.find(val).value = r.values[val].newValue;
            }
            await f.save();
        }

    }
    async updateAllCol(col: Column<any>) {
        let count = this.getColUpdateCount(col);
        let message = "האם לעדכן את השדה " + col.defs.caption + " ל" + count + translate(" משפחות?");
        if (col.defs.key == this.f.address.defs.key)
            message += 'שים לב- עדכון של שדה כתובת יכול לקחת יותר זמן משדות אחרים';
        this.dialog.YesNoQuestion(message, () => {
            this.busy.doWhileShowingBusy(async () => {
                let rowsToUpdate: excelRowInfo[] = [];
                let allRows: excelRowInfo[] = [];
                let lastDate = new Date().valueOf();
                for (const i of this.updateRows) {
                    let cc = this.getColInfo(i, col);
                    if (cc.newDisplayValue != cc.existingDisplayValue) {
                        rowsToUpdate.push(i);
                    }
                    else
                        allRows.push(i);

                    if (rowsToUpdate.length == 35) {
                        allRows.push(...await ImportFromExcelComponent.updateColsOnServer(rowsToUpdate, col.defs.key));
                        if (new Date().valueOf() - lastDate > 1000) {
                            this.dialog.Info(i.rowInExcel + ' ' + (i.name));
                        }
                        rowsToUpdate = [];
                    }



                }
                if (rowsToUpdate.length > 0) {
                    allRows.push(...await ImportFromExcelComponent.updateColsOnServer(rowsToUpdate, col.defs.key));
                }
                allRows.sort((a, b) => a.rowInExcel - b.rowInExcel);
                this.updateRows = allRows;
            });
        });
    }

    @ServerFunction({ allowed: Roles.admin })
    static async updateColsOnServer(rowsToUpdate: excelRowInfo[], columnMemberName: string, context?: Context) {
        for (const r of rowsToUpdate) {
            await ImportFromExcelComponent.actualUpdateCol(r, columnMemberName, context);
        }
        return rowsToUpdate;
    }
    async updateCol(i: excelRowInfo, col: Column<any>) {
        await ImportFromExcelComponent.actualUpdateCol(i, col.defs.key, this.context);
    }
    static async actualUpdateCol(i: excelRowInfo, colMemberName: string, context: Context) {
        let c = ImportFromExcelComponent.actualGetColInfo(i, colMemberName);
        if (c.existingDisplayValue == c.newDisplayValue)
            return;
        let f = await context.for(Families).findFirst(f => f.id.isEqualTo(i.duplicateFamilyInfo[0].id));
        let val = c.newValue;
        if (val === null)
            val = '';
        f.columns.find(colMemberName).value = val;
        await f.save();
        c.existingDisplayValue = await getColumnDisplayValue(f.columns.find(colMemberName));
        c.existingValue = f.columns.find(colMemberName).value;
    }
    async clearColumnUpdate(i: excelRowInfo, col: Column<any>) {
        let c = this.getColInfo(i, col);
        c.newDisplayValue = c.existingDisplayValue;
        c.newValue = c.existingValue;
    }

    getColUpdateCount(col: Column<any>) {
        let i = 0;
        let key = col.defs.key;
        for (const r of this.updateRows) {
            let c = r.values[key];
            if (c && c.newDisplayValue != c.existingDisplayValue)
                i++;
        }
        return i;
    }

    async fileChange(eventArgs: any) {

        var files = eventArgs.target.files, file;
        if (!files || files.length == 0) return;
        file = files[0];
        var fileReader = new FileReader();
        fileReader.onload = async (e: any) => {
            this.filename = file.name;
            // pre-process data
            var binary = "";
            var bytes = new Uint8Array(e.target.result);
            var length = bytes.byteLength;
            for (var i = 0; i < length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            // call 'xlsx' to read the file
            this.oFile = (await import('xlsx')).read(binary, { type: 'binary', cellDates: true, cellStyles: true });
            this.worksheet = this.oFile.Sheets[this.oFile.SheetNames[0]];
            let sRef = this.worksheet["!ref"];
            let to = sRef.substr(sRef.indexOf(':') + 1);

            let maxLetter = 'A';
            for (let index = 0; index < to.length; index++) {
                const element = to[index];
                if ('1234567890'.indexOf(element) >= 0) {
                    maxLetter = to.substring(0, index);
                    this.totalRows = +to.substring(index, 20);
                    break;
                }

            }

            if (!this.totalRows) {
                debugger;
            }
            let colPrefix = '';
            let colName = 'A';
            let colIndex = 0;
            this.excelColumns = [];
            while (true) {
                this.excelColumns.push({
                    excelColumn: colPrefix + colName,
                    column: undefined,
                    title: this.getTheData(colPrefix + colName + 1)
                });
                let done = false;
                if (colPrefix + colName == maxLetter)
                    done = true;
                let j = colName.charCodeAt(0);
                j++;
                colName = String.fromCharCode(j);
                if (colName > 'Z') {
                    colName = 'A';
                    if (colPrefix == 'A')
                        colPrefix = 'B';
                    else
                        colPrefix = 'A';
                }
                if (done) {

                    break;
                }
            }
            for (const col of this.excelColumns) {

                let searchName = col.title;
                switch (searchName) {
                    case this.f.deliverStatus.defs.caption:
                    case this.f.courier.defs.caption:
                    case this.f.fixedCourier.defs.caption:
                        break;
                    default:
                        for (const up of this.columns) {
                            if (searchName == up.name || (up.searchNames && up.searchNames.indexOf(searchName) >= 0)) {
                                col.column = up;
                                break;
                            }

                        }
                        break;
                }


            }
            this.rows = [];
            for (let index = 2; index <= this.totalRows; index++) {
                this.rows.push(index);
            }
            this.stepper.next();
        };
        fileReader.readAsArrayBuffer(file);
    }

    async readLine(row: number): Promise<excelRowInfo> {
        let f = this.context.for(Families).create();
        f._disableAutoDuplicateCheck = true;
        f.deliverStatus.value = this.settings.defaultStatusType.value;

        let helper = new columnUpdateHelper(this.context, this.dialog);
        for (const c of this.excelColumns) {
            if (c.column) {
                let val = this.getTheData(c.excelColumn + row);
                if (val && val.length > 0)
                    await c.column.updateFamily(val, f, helper);
            }
        }
        for (const v of this.additionalColumns) {
            await v.column.updateFamily(v.value, f, helper);
        }
        helper.laterSteps.sort((a, b) => a.step - b.step);
        for (const s of helper.laterSteps) {
            s.what();
        }


        if (f.phone1.displayValue == f.phone2.displayValue)
            f.phone2.value = '';

        let info: excelRowInfo = {
            name: f.name.value,
            tz: f.tz.value,
            tz2: f.tz2.value,
            phone1: f.phone1.value,
            phone2: f.phone2.value,
            valid: true,
            rowInExcel: row,
            values: {}
        };
        if (!f.name.value) {
            info.error = 'שורה ללא שם';
        }
        for (const c of f.columns) {
            if (c.validationError) {
                if (c.validationError) {
                    c.validationError += ", ";
                }
                c.validationError += c.defs.caption + ": " + c.validationError;
                info.valid = false;
            }
            if (c.value) {
                info.values[c.defs.key] = {
                    newDisplayValue: await getColumnDisplayValue(c),
                    newValue: c.value
                };
            }
        }


        return info;

    }


    f: Families;
    @ViewChild("stepper", { static: true }) stepper: MatStepper;
    settings: ApplicationSettings;
    async ngOnInit() {
        this.settings = await ApplicationSettings.getAsync(this.context);





        let updateCol = (col: Column<any>, val: string, seperator: string = ' ') => {

            if (col.value) {
                col.value = (col.value + seperator + val).trim();
            } else
                col.value = val;
        }
        this.f = this.context.for(Families).create();
        if (false) {
            try {
                this.errorRows = JSON.parse(sessionStorage.getItem("errorRows"));
                this.newRows = JSON.parse(sessionStorage.getItem("newRows"));
                this.updateRows = JSON.parse(sessionStorage.getItem("updateRows"));
                this.identicalRows = JSON.parse(sessionStorage.getItem("identicalRows"));
                this.columnsInCompare = JSON.parse(sessionStorage.getItem("columnsInCompare")).map(x => this.f.columns.find(x));
                if (this.columnsInCompare.length > 0) {
                    setTimeout(() => {
                        this.stepper.next();
                        this.stepper.next();

                    }, 100);
                }
            }
            catch (err) {
                console.log(err);
            }
        }

        let addColumn = (col: Column<any>, searchNames?: string[]) => {
            this.columns.push({
                key: col.defs.key,
                name: col.defs.caption,
                updateFamily: async (v, f) => {
                    updateCol(f.columns.find(col), v);
                },
                searchNames: searchNames,
                columns: [col]
            });
        }
        let addColumns = (cols: Column<any>[]) => {
            for (const col of cols) {
                addColumn(col);
            }
        };
        addColumn(this.f.name, ["משפחה", "שם משפחה"]);
        this.columns.push({
            key: 'firstName',
            name: 'שם פרטי',
            updateFamily: async (v, f, h) => { h.laterSteps.push({ step: 2, what: () => updateCol(f.name, v) }) },
            columns: [this.f.name],
            searchNames: ["פרטי"]
        });
        addColumns([

            this.f.postalCode
        ]);
        this.columns.push({
            key: 'address',
            name: 'כתובת',
            searchNames: ['רחוב'],
            updateFamily: async (v, f) => {
                let r = parseAddress(v);
                if (r.address)
                    updateCol(f.address, r.address);
                if (r.dira)
                    updateCol(f.appartment, r.dira);
                if (r.floor)
                    updateCol(f.floor, r.floor);
                if (r.knisa)
                    updateCol(f.entrance, r.knisa);
            },
            columns: [this.f.address, this.f.appartment, this.f.floor, this.f.entrance]
        });
        this.columns.push({
            key: 'city',
            name: 'עיר',
            searchNames: ['ישוב', 'יישוב'],
            updateFamily: async (v, f, h) => {
                h.laterSteps.push({
                    step: 3,
                    what: () => updateCol(f.address, v)
                })
            }
            , columns: [this.f.address]
        });
        this.columns.push({
            key: 'houseNum',
            name: 'מספר בית',
            searchNames: ["בית", "מס' בית", "מס בית"],
            updateFamily: async (v, f, h) => {
                h.laterSteps.push({
                    step: 2,
                    what: () => updateCol(f.address, v)
                });

            }
            , columns: [this.f.address]
        });
        this.columns.push({
            key: 'boxes',
            name: 'מספר מנות',
            updateFamily: async (v, f, h) => {
                await h.lookupAndInsert(BasketType, b => b.boxes, +v, b => b.id, f.basketType, b => b.name.value = v + ' מנות');

            }, columns: [this.f.basketType]
        });
        this.columns.push({
            key: 'basketType',
            name: 'סוג סל',
            updateFamily: async (v, f, h) => {
                await h.lookupAndInsert(BasketType, b => b.name, v, b => b.id, f.basketType);
            }, columns: [this.f.basketType]
        });
        this.columns.push({
            key: 'familySource',
            name: this.f.familySource.defs.caption,
            updateFamily: async (v, f, h) => {
                await h.lookupAndInsert(FamilySources, f => f.name, v, f => f.id, f.familySource);
            }, columns: [this.f.familySource]
        });
        this.columns.push({
            key: 'selfPickup',
            name: 'באים לקחת',
            updateFamily: async (v, f) => {
                if (v == "כן") {
                    f.defaultSelfPickup.value = true;
                    if (f.deliverStatus.value == DeliveryStatus.ReadyForDelivery)
                        f.deliverStatus.value = DeliveryStatus.SelfPickup;
                }
            }, columns: [this.f.defaultSelfPickup]
        });
        this.columns.push({
            key: 'fixedCourier',
            name: this.f.fixedCourier.defs.caption,
            updateFamily: async (v, f, h) => {
                await h.lookupAndInsert(Helpers, h => h.name, v, h => h.id, f.fixedCourier);
            }, columns: [this.f.fixedCourier]
        });
        this.columns.push({
            key: 'courier',
            name: this.f.courier.defs.caption,
            updateFamily: async (v, f, h) => {
                await h.lookupAndInsert(Helpers, h => h.name, v, h => h.id, f.courier);
            }, columns: [this.f.courier]
        });
        this.columns.push({
            key: 'deliverStatus',
            name: this.f.deliverStatus.defs.caption,
            updateFamily: async (v, f, h) => {
                switch (v) {
                    case DeliveryStatus.NotInEvent.caption:
                        f.deliverStatus.value = DeliveryStatus.NotInEvent;
                        break;
                    case DeliveryStatus.ReadyForDelivery.caption:
                        f.deliverStatus.value = DeliveryStatus.ReadyForDelivery;
                        if (f.defaultSelfPickup.value)
                            f.deliverStatus.value = DeliveryStatus.SelfPickup;
                        break;
                    case DeliveryStatus.SelfPickup.caption:
                        f.deliverStatus.value = DeliveryStatus.SelfPickup;
                        break;
                    case DeliveryStatus.Success.caption:
                        f.deliverStatus.value = DeliveryStatus.Success;
                        break;
                    default:
                        throw f.deliverStatus.defs.caption + " ערך לא ברור - " + v;
                        break;

                }
            }, columns: [this.f.deliverStatus]
        });
        this.columns.push({
            key: 'anyPhone',
            name: 'טלפון',
            columns: [this.f.phone1, this.f.phone2],
            updateFamily: async (v, f) => {
                if (f.phone1.value && f.phone1.value.length > 0)
                    updateCol(f.phone2, fixPhone(v, this.settings.defaultPrefixForExcelImport.value));
                else
                    updateCol(f.phone1, fixPhone(v, this.settings.defaultPrefixForExcelImport.value));
            },
            searchNames: ['טלפון נייד']
        });
        for (const c of [this.f.phone1, this.f.phone2, this.f.socialWorkerPhone1, this.f.socialWorkerPhone2]) {
            this.columns.push({
                key: c.defs.key,
                name: c.defs.caption,
                columns: [c],
                updateFamily: async (v, f) => updateCol(f.columns.find(c), fixPhone(v, this.settings.defaultPrefixForExcelImport.value))
            });
        }


        addColumn(this.f.familyMembers, ["נפשות", "מס נפשות"]);
        addColumn(this.f.tz, ["ת.ז.", "ת\"ז"]);
        addColumn(this.f.tz2);
        addColumns([

            this.f.iDinExcel,

            this.f.floor,
            this.f.appartment,
            this.f.entrance,
            this.f.socialWorker

        ]);
        for (const col of [this.f.phone1Description,
        this.f.phone2Description,
        this.f.internalComment,
        this.f.deliveryComments,
        this.f.addressComment]) {
            this.columns.push({
                key: col.defs.key,
                name: col.defs.caption,
                updateFamily: async (v, f, h) => {

                    updateCol(f.columns.find(col), v, ', ');
                }, columns: [col]
            });
        }
        this.columns.push({
            key: this.f.groups.defs.key,
            name: this.f.groups.defs.caption,
            updateFamily: async (v, f, h) => {
                if (v && v.trim().length > 0) {
                    await h.lookupAndInsert(Groups, g => g.name, v, g => g.id, new IdColumn(f.groups.defs.caption));
                }
                updateCol(f.columns.find(this.f.groups), v, ', ');
            }, columns: [this.f.groups]
        });

        this.columns.sort((a, b) => a.name > b.name ? 1 : a.name < b.name ? -1 : 0);

    }
    async doImport() {
        this.dialog.YesNoQuestion("האם אתה בטוח שאתה מעוניין לקלוט " + (this.totalRows - 1) + translate(" משפחות מאקסל?"), async () => {
            await this.iterateExcelFile(true);
        });
    }
    errorRows: excelRowInfo[] = [];
    newRows: excelRowInfo[] = [];
    identicalRows: excelRowInfo[] = [];
    updateRows: excelRowInfo[] = [];


    async iterateExcelFile(actualImport = false) {

        this.errorRows = [];
        this.newRows = [];
        this.updateRows = [];
        this.identicalRows = [];
        let rows: excelRowInfo[] = [];
        let usedTz = new Map<number, number>();
        let usedPhone = new Map<number, number>();
        this.stepper.next();
        await this.busy.doWhileShowingBusy(async () => {
            let updatedColumns = new Map<Column<any>, boolean>();
            updatedColumns.set(this.f.deliverStatus, true);
            for (const cu of [...this.excelColumns.map(f => f.column), ...this.additionalColumns.map(f => f.column)]) {
                if (cu)
                    for (const c of cu.columns) {
                        updatedColumns.set(c, true);
                    }
            }
            this.columnsInCompare = [];
            for (let c of this.f.columns) {
                if (updatedColumns.get(c))
                    this.columnsInCompare.push(c);
            }
            let columnsInCompareMemberName = this.columnsInCompare.map(x => x.defs.key);

            await new Promise((resolve) => setTimeout(() => {
                resolve();
            }, 500));
            try {
                for (let index = 2; index <= this.totalRows; index++) {
                    let f = await this.readLine(index);
                    if (f.error) {
                        this.errorRows.push(f);
                    }
                    else {

                        let exists = (val: string, map: Map<number, number>, caption: string) => {
                            let origVal = val;
                            if (!val)
                                return false;
                            val = val.replace(/\D/g, '');
                            if (val.length == 0)
                                return false;
                            let x = map.get(+val);
                            if (x > 0 && x < index) {
                                f.error = caption + ' - ' + origVal + ' - כבר קיים בקובץ בשורה ' + x;
                                return true;
                            }
                            map.set(+val, index);
                            return false;
                        };


                        if (exists(f.tz, usedTz, 'תעודת זהות') || exists(f.phone1, usedPhone, 'טלפון 1') || exists(f.phone2, usedPhone, 'טלפון 2')) {
                            this.errorRows.push(f);
                        }
                        else
                            rows.push(f);
                    }

                    if (rows.length == 200) {
                        this.dialog.Info((index - 1) + ' ' + (f.name ? f.name : 'ללא שם') + ' ' + (f.error ? f.error : ''));
                        let r = await this.checkExcelInput(rows, columnsInCompareMemberName);
                        this.errorRows.push(...r.errorRows);
                        this.newRows.push(...r.newRows);
                        this.updateRows.push(...r.updateRows);
                        this.identicalRows.push(...r.identicalRows);
                        rows = [];
                    }
                }
                if (rows.length > 0) {

                    let r = await this.checkExcelInput(rows, columnsInCompareMemberName);
                    this.errorRows.push(...r.errorRows);
                    this.newRows.push(...r.newRows);
                    this.updateRows.push(...r.updateRows);
                    this.identicalRows.push(...r.identicalRows);
                }



                let check = new Map<string, excelRowInfo[]>();
                let collected: excelRowInfo[][] = [];
                for (const row of this.updateRows) {
                    if (row.duplicateFamilyInfo && row.duplicateFamilyInfo.length == 1) {
                        let rowInfo: excelRowInfo[];
                        if (rowInfo = check.get(row.duplicateFamilyInfo[0].id)) {
                            rowInfo.push(row);
                        }
                        else {
                            let arr = [row];
                            check.set(row.duplicateFamilyInfo[0].id, arr);
                            collected.push(arr);
                        }
                    }
                }
                this.errorRows.sort((a, b) => a.rowInExcel - b.rowInExcel);
                for (const iterator of collected) {
                    if (iterator.length > 1) {
                        for (const row of iterator) {
                            row.error = translate('אותה משפחה באתר מתאימה למספר שורות באקסל: ') + iterator.map(x => x.rowInExcel.toString()).join(', ');
                            this.errorRows.push(row);
                            this.updateRows.splice(this.updateRows.indexOf(row), 1);
                        }
                    }
                }


                sessionStorage.setItem("errorRows", JSON.stringify(this.errorRows));
                sessionStorage.setItem("newRows", JSON.stringify(this.newRows));
                sessionStorage.setItem("updateRows", JSON.stringify(this.updateRows));
                sessionStorage.setItem("identicalRows", JSON.stringify(this.identicalRows));

                sessionStorage.setItem("columnsInCompare", JSON.stringify(columnsInCompareMemberName));
            }
            catch (err) {
                this.stepper.previous();
                this.dialog.Error("הקליטה הופסקה - " + err);
            }
        });


    }
    displayDupInfo(info: duplicateFamilyInfo) {
        let r = [];


        if (info.tz) {
            r.push(' מספר זהות זהה');
        }
        if (info.phone1 || info.phone2) {
            r.push(' מספר טלפון זהה');
        }
        if (info.nameDup) {
            r.push(" שם זהה");
        }
        return info.address + ": " + r.join(', ');
    }
    @ServerFunction({ allowed: Roles.admin })
    async checkExcelInput(excelRowInfo: excelRowInfo[], columnsInCompareMemeberName: string[], context?: Context, db?: SqlDatabase) {
        let result: serverCheckResults = {
            errorRows: [],
            identicalRows: [],
            newRows: [],
            updateRows: []
        } as serverCheckResults;
        for (const info of excelRowInfo) {
            info.duplicateFamilyInfo = await Families.checkDuplicateFamilies(info.name, info.tz, info.tz2, info.phone1, info.phone2, undefined, true, context, db);

            if (!info.duplicateFamilyInfo || info.duplicateFamilyInfo.length == 0) {
                result.newRows.push(info);
            } else if (info.duplicateFamilyInfo.length > 1) {
                info.error = translate('משפחה קיימת יותר מפעם אחת בבסיס נתונים');
                result.errorRows.push(info);
            } else {
                let ef = await context.for(Families).findFirst(f => f.id.isEqualTo(info.duplicateFamilyInfo[0].id));
                let hasDifference = false;
                for (const columnMemberName of columnsInCompareMemeberName) {

                    let upd = info.values[columnMemberName];
                    if (!upd) {
                        upd = { newDisplayValue: '', newValue: '', existingDisplayValue: '', existingValue: '' };
                        info.values[columnMemberName] = upd;
                    }

                    let col = ef.columns.find(columnMemberName);
                    upd.existingValue = col.value;
                    upd.existingDisplayValue = await getColumnDisplayValue(col);
                    if (upd.existingValue == upd.newValue && upd.existingValue == "")
                        upd.newDisplayValue = upd.existingDisplayValue;
                    if (upd.existingDisplayValue != upd.newDisplayValue) {

                        if (col == ef.groups) {
                            let existingString = ef.groups.value;
                            let newVal = upd.newValue;
                            if (!newVal || newVal.toString() == '') {
                                upd.newValue = upd.existingValue;
                                upd.newDisplayValue = upd.existingDisplayValue;
                            }
                            else if (existingString && existingString.trim().length > 0) {
                                let existingArray = existingString.toString().split(',').map(x => x.trim())
                                for (const val of newVal.split(',').map(x => x.trim())) {
                                    if (existingArray.indexOf(val) < 0)
                                        existingArray.push(val);
                                }
                                upd.newValue = existingArray.join(', ');
                                upd.newDisplayValue = upd.newValue;
                            }
                        }
                        if (upd.existingDisplayValue != upd.newDisplayValue) {
                            hasDifference = true;
                        }
                    }
                }
                if (ef.deliverStatus.value == DeliveryStatus.RemovedFromList) {
                    info.error = 'משפחה מעודכנת בבסיס הנתונים כהוצא מהרשימות';
                    result.errorRows.push(info);
                }
                else if (hasDifference) {
                    result.updateRows.push(info);
                }
                else
                    result.identicalRows.push(info);
            }
        }
        return result;
    }


    saveSettings() {
        let save: storedInfo = {
            storedColumns: [],
            additionalColumns: []
        };
        for (const item of this.excelColumns) {
            save.storedColumns.push({
                excelColumn: item.excelColumn,
                columnKey: item.column ? item.column.key : undefined
            });
        }
        for (const item of this.additionalColumns) {
            save.additionalColumns.push({
                value: item.value,
                columnKey: item.column ? item.column.key : undefined
            });
        }
        localStorage.setItem(excelSettingsSave, JSON.stringify(save));
    }
    loadSettings() {
        let loaded = JSON.parse(localStorage.getItem(excelSettingsSave)) as storedInfo;
        if (loaded) {
            for (const excelItem of this.excelColumns) {
                for (const loadedItem of loaded.storedColumns) {
                    if (loadedItem.excelColumn == excelItem.excelColumn) {
                        excelItem.column = undefined;
                        for (const col of this.columns) {
                            if (col.key == loadedItem.columnKey) {
                                excelItem.column = col;
                            }
                        }
                    }
                }
            }
            this.additionalColumns = [];
            for (const loadedItem of loaded.additionalColumns) {

                for (const col of this.columns) {
                    if (col.key == loadedItem.columnKey) {
                        this.additionalColumns.push({
                            column: col,
                            value: loadedItem.value
                        });
                    }
                }
            }

        }
    }
    moveFromErrorToAdd(r: excelRowInfo) {
        this.dialog.YesNoQuestion(translate("להעביר את משפחת ") + r.name + translate(" למשפחות להוספה?"), () => {
            let x = this.errorRows.indexOf(r);
            this.errorRows.splice(x, 1);
            this.newRows.push(r);
            this.newRows.sort((a, b) => a.rowInExcel - b.rowInExcel);
        });

    }
    moveFromUpdateToAdd(r: excelRowInfo) {
        this.dialog.YesNoQuestion(translate("להעביר את משפחת ") + r.name + translate(" למשפחות להוספה?"), () => {
            let x = this.updateRows.indexOf(r);
            this.updateRows.splice(x, 1);
            this.newRows.push(r);
            this.newRows.sort((a, b) => a.rowInExcel - b.rowInExcel);
        });

    }

    async testImport() {
        await this.iterateExcelFile(false);

    }
    async updateFamily(i: duplicateFamilyInfo) {
        let f = await this.context.for(Families).findFirst(f => f.id.isEqualTo(i.id));
        this.context.openDialog(UpdateFamilyDialogComponent, x => x.args = { f: f });
    }
}


const excelSettingsSave = 'excelSettingsSave';


interface excelColumn {
    excelColumn: string;
    column: columnUpdater;
    title: string;
}
interface additionalColumns {
    column?: columnUpdater,
    value?: string
}
interface storedInfo {
    storedColumns: storedColumnSettings[],
    additionalColumns: storedAdditionalColumnSettings[]
}
interface storedColumnSettings {
    excelColumn: string;
    columnKey: string;
}
interface storedAdditionalColumnSettings {
    columnKey: string;
    value: string;
}
interface columnUpdater {
    key: string;
    name: string;
    searchNames?: string[];
    updateFamily: (val: string, f: Families, h: columnUpdateHelper) => Promise<void>;
    columns: Column<any>[];
}
class columnUpdateHelper {
    constructor(private context: Context, private dialog: DialogService) {

    }
    laterSteps: laterSteps[] = [];

    async lookupAndInsert<T extends Entity<any>, dataType>(
        c: { new(...args: any[]): T; },
        getSearchColumn: ((entity: T) => Column<dataType>),
        val: dataType,
        idColumn: ((entity: T) => IdColumn),
        updateResultTo: IdColumn,
        additionalUpdates?: ((entity: T) => void)) {
        let x = await this.context.for(c).lookupAsync(e => (getSearchColumn(e).isEqualTo(val)));
        if (x.isNew()) {
            let s = updateResultTo.defs.caption + " \"" + val + "\" לא קיים";
            if (await this.dialog.YesNoPromise(s + ", האם להוסיף?")) {
                getSearchColumn(x).value = val;
                if (additionalUpdates)
                    additionalUpdates(x);
                await x.save();
            }
            else {
                throw s;
            }
        }
        updateResultTo.value = idColumn(x).value;
    }
}
interface excelRowInfo {
    rowInExcel: number;
    name: string;
    tz: string;
    tz2: string;
    phone1: string;
    phone2: string;
    valid: boolean;
    error?: string;

    duplicateFamilyInfo?: duplicateFamilyInfo[];
    values: { [key: string]: updateColumns };
}
interface updateColumns {

    existingValue?: any;
    existingDisplayValue?: string;
    newValue: any;
    newDisplayValue: any;
}
interface serverCheckResults {
    newRows: excelRowInfo[],
    identicalRows: excelRowInfo[],
    updateRows: excelRowInfo[],
    errorRows: excelRowInfo[]
}
async function getColumnDisplayValue(c: Column<any>) {
    let v = c.displayValue;
    let getv: HasAsyncGetTheValue = <any>c as HasAsyncGetTheValue;
    if (getv && getv.getTheValue) {
        v = await getv.getTheValue();
    }
    return v.trim();
}
interface laterSteps {
    step: number,
    what: () => void
}

export function fixPhone(phone: string, defaultPrefix: string) {
    if (!phone)
        return phone;
    if (phone.startsWith('0'))
        return phone;
    if (phone.length == 8 || phone.length == 9)
        return '0' + phone;
    if (phone.length == 7 && defaultPrefix && defaultPrefix.length > 0)
        return defaultPrefix + phone;
    return phone;
}
